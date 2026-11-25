import { Body, Controller, Get, Logger, Post, Query, Req, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { FastifyReply, FastifyRequest } from 'fastify';
import { WorkspaceRoutingService } from '../../shared/services/workspace-routing.service';
import { TrackingIngestService } from './tracking-ingest.service';
import { CollectBatch, CollectEvent, isBot, parseCollectBody, peekCollectBody } from './collect-payload';
import { buildTrackerScript, NOOP_TRACKER_SCRIPT } from './tracker-script';
import { MetaCapiService, WebEventInput } from '../meta-capi/meta-capi.service';
import { DebugService } from '../debug/debug.service';
import { debugContext, DebugTrace } from '../debug/debug-context';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HOST = /^[a-z0-9.-]+(:\d{1,5})?$/i;

/** Limite do /collect por IP. Uma visita manda de 2 a 5 requisições; o preview, bem mais. */
const COLLECT_LIMIT_PER_MINUTE = 300;
const RATE_WINDOW_MS = 60_000;

const YEAR_S = 365 * 24 * 3600;
const FB_COOKIE_S = 90 * 24 * 3600;

type Headers = Record<string, string | string[] | undefined>;

function header(headers: Headers, name: string): string | null {
  const value = headers[name];
  const first = Array.isArray(value) ? value[0] : value;
  return first?.trim() || null;
}

/** Headers de geolocalização da Vercel vêm com URL encoding ("S%C3%A3o%20Paulo"). */
function geoHeader(headers: Headers, name: string): string | null {
  const value = header(headers, name);
  if (!value) return null;
  try {
    return decodeURIComponent(value).slice(0, 100);
  } catch {
    return value.slice(0, 100);
  }
}

/**
 * IP do visitante. Na Vercel o socket é da borda — o IP real vem no
 * x-forwarded-for. Com o snippet no subdomínio do cliente, a requisição sai
 * direto do navegador, então esse é o IP que a CAPI espera.
 */
function clientIp(req: FastifyRequest): string | null {
  const headers = req.headers as Headers;
  const forwarded = header(headers, 'x-forwarded-for')?.split(',')[0].trim();
  const ip = forwarded || header(headers, 'x-real-ip') || req.ip || null;
  return ip && /^[0-9a-f.:]{3,45}$/i.test(ip) ? ip : null;
}

function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Domínio raiz comum entre o subdomínio de rastreio (track.loja.com.br) e a
 * página (www.loja.com.br): "loja.com.br". É nele que o servidor grava os
 * cookies, para a página enxergá-los. Sem domínio em comum — o snippet servido
 * pelo domínio da Vercel, por exemplo — não há cookie de servidor.
 */
export function sharedCookieDomain(requestHost: string | null, pageHost: string | null): string | null {
  if (!requestHost || !pageHost || requestHost === pageHost) return null;
  const labels = requestHost.split('.');
  if (labels.length < 3) return null;
  const parent = labels.slice(1).join('.');
  return pageHost === parent || pageHost.endsWith(`.${parent}`) ? parent : null;
}

/**
 * Endpoints públicos do snippet: o script, a ingestão e a verificação do
 * subdomínio.
 *
 * Fora do ThrottlerGuard global: ele conta por req.ip, que na Vercel é o IP
 * da borda — todos os visitantes dividiriam os mesmos 60 por minuto. O limite
 * daqui conta pelo IP real, por instância da função.
 */
@SkipThrottle()
@Controller('t')
export class TrackingCollectController {
  private readonly logger = new Logger(TrackingCollectController.name);
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly ingestService: TrackingIngestService,
    private readonly capi: MetaCapiService,
    private readonly debug: DebugService,
    private readonly workspaceRouting: WorkspaceRoutingService,
  ) {}

  @Get('tracker.js')
  async trackerScript(
    @Query('tid') tid: string | undefined,
    @Req() req: FastifyRequest,
    @Res() res: FastifyReply,
  ): Promise<void> {
    res.header('Content-Type', 'application/javascript; charset=utf-8');

    const requestedId = tid?.trim().toLowerCase() ?? '';
    const workspaceId = UUID.test(requestedId) ? await this.workspaceRouting.resolve(requestedId) : null;

    if (!workspaceId) {
      // 200 com script vazio, e não 404: um 404 aparece como erro no console
      // da página do cliente, para os visitantes dele.
      res.header('Cache-Control', 'public, max-age=300');
      res.status(200).send(NOOP_TRACKER_SCRIPT);
      return;
    }

    const config = await this.capi.getConfig(workspaceId);

    // Cache curto: trocar a plataforma em Integrações muda o parâmetro do
    // indexador, e a página do cliente precisa pegar isso logo.
    res.header('Cache-Control', 'public, max-age=300');
    res.status(200).send(
      buildTrackerScript(workspaceId, this.collectUrl(req), {
        param: config?.param ?? 'sck',
        pixelId: config?.pixelId ?? null,
        xcodUtm: config?.platform === 'hotmart',
      }),
    );
  }

  /**
   * Recebe o lote do snippet, grava e manda PageView/InitiateCheckout para a
   * CAPI. Sempre 200 e corpo vazio: sendBeacon ignora a resposta, e um erro
   * não daria ao navegador do visitante nada a fazer.
   *
   * Tudo roda dentro de um rastro de debug: com a área em preview, o painel
   * mostra a requisição, as variáveis, as tags e o que saiu para o Meta.
   */
  @Post('collect')
  async collect(
    @Body() body: unknown,
    @Req() req: FastifyRequest,
    @Res() res: FastifyReply,
  ): Promise<void> {
    res.header('Access-Control-Allow-Origin', '*');
    const headers = req.headers as Headers;
    const ip = clientIp(req);
    const peek = peekCollectBody(body);
    const trace = new DebugTrace('collect', 'Web — snippet', {
      method: 'POST',
      path: '/api/t/collect',
      query: (req.query as Record<string, unknown>) ?? {},
      headers: { ...headers, 'x-client-ip': ip },
      body,
    });
    trace.setWorkspace(peek.workspaceId);
    trace.browserToken = peek.debugToken;

    await debugContext.run(trace, async () => {
      try {
        await this.handleCollect(body, req, res, headers, ip, trace);
      } catch (error: any) {
        this.logger.error(`Erro no collect: ${error?.message}`, error?.stack);
      }
      trace.respond(200, '');
      if (trace.events.some((name) => META_EVENTS.has(name))) await this.debug.saveServerTrace(trace);
    });

    res.status(200).send();
  }

  private async handleCollect(
    body: unknown,
    req: FastifyRequest,
    res: FastifyReply,
    headers: Headers,
    ip: string | null,
    trace: DebugTrace,
  ): Promise<void> {
    if (!this.allow(ip ?? 'unknown')) {
      trace.title = 'Descartado — limite por IP';
      trace.log(`Mais de ${COLLECT_LIMIT_PER_MINUTE} requisições por minuto deste IP: lote ignorado.`, 'warn');
      return;
    }

    const userAgent = header(headers, 'user-agent')?.slice(0, 500) ?? null;
    if (isBot(userAgent)) {
      trace.title = 'Descartado — robô';
      trace.log(`User agent de robô ou ausente: lote ignorado (${userAgent ?? 'sem user agent'}).`, 'warn');
      return;
    }

    const batch = parseCollectBody(body);
    if (!batch) {
      trace.title = 'Descartado — lote inválido';
      trace.log('O corpo não é um lote válido (tid, vid, sid ou events ausentes ou fora do formato).', 'warn');
      return;
    }

    const workspaceId = await this.workspaceRouting.resolve(batch.workspaceId);
    if (!workspaceId) {
      trace.title = 'Descartado — painel inexistente';
      return;
    }
    batch.workspaceId = workspaceId;
    trace.setWorkspace(workspaceId);

    const ctx = {
      ip,
      userAgent,
      country: geoHeader(headers, 'x-vercel-ip-country'),
      region: geoHeader(headers, 'x-vercel-ip-country-region'),
      city: geoHeader(headers, 'x-vercel-ip-city'),
    };
    trace.title = batch.events.map(eventLabel).join(', ');
    for (const ev of batch.events) trace.event(eventLabel(ev));
    trace.variable('Visitante', {
      visitor_id: batch.visitorId,
      session_id: batch.sessionId,
      fbp: batch.fbp,
      fbc: batch.fbc,
      ip: ctx.ip,
      user_agent: ctx.userAgent,
      pais: ctx.country,
      estado: ctx.region,
      cidade: ctx.city,
      tela: batch.screenResolution,
      idioma: batch.language,
    });
    trace.variable('Eventos do lote', batch.events);

    // Gravação e envio ao Meta em paralelo: um não depende do outro, e os
    // dois precisam terminar antes da resposta (a função congela depois).
    const [saved] = await Promise.all([
      this.ingestService.ingest(batch, ctx),
      this.capi.sendWebEvents(batch.workspaceId, this.webEvents(batch, ctx)),
      this.ingestService.ingestHeatmap(batch),
    ]);
    trace.tag({
      name: 'Gravar visita no banco',
      status: saved > 0 ? 'fired' : 'failed',
      detail: saved > 0 ? `${saved} evento(s) gravado(s)` : 'tracking_ingest não gravou nada (veja o console).',
    });

    const cookieDomain = this.setFirstPartyCookies(req, res, batch);
    trace.tag({
      name: 'Cookies first-party (_stl_vid, _fbp, _fbc)',
      status: cookieDomain ? 'fired' : 'not_fired',
      detail: cookieDomain
        ? `Gravados pelo servidor no domínio ${cookieDomain}`
        : 'O snippet não está num subdomínio do site: valem só os cookies gravados pelo navegador.',
    });
  }

  /**
   * Mensagens do navegador em preview: o lado web do debug. Só grava com o
   * token do preview ligado na área.
   */
  @Post('debug')
  async debugMessages(@Body() body: unknown, @Req() req: FastifyRequest, @Res() res: FastifyReply): Promise<void> {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Cache-Control', 'no-store');
    if (!this.allow(clientIp(req) ?? 'unknown')) {
      res.status(200).send({ ok: false, reason: 'limite' });
      return;
    }
    const result = await this.debug.saveWebMessages(body).catch(() => ({ ok: false, reason: 'erro' }));
    res.status(200).send(result);
  }

  /**
   * O painel usa para conferir se o CNAME do subdomínio já aponta para cá:
   * busca https://<subdomínio>/api/t/ping direto do navegador.
   */
  @Get('ping')
  ping(@Res() res: FastifyReply): void {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Cache-Control', 'no-store');
    res.status(200).send({ ok: true, service: 'dashzip-tracking' });
  }

  private webEvents(
    batch: CollectBatch,
    ctx: { ip: string | null; userAgent: string | null; country: string | null; region: string | null; city: string | null },
  ): WebEventInput[] {
    return batch.events
      .filter((e) => (e.type === 'pageview' || e.type === 'checkout_click') && e.event_id)
      .map((e) => ({
        type: e.type as WebEventInput['type'],
        eventId: e.event_id!,
        url: e.url,
        visitorId: batch.visitorId,
        sessionId: batch.sessionId,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        fbp: batch.fbp,
        fbc: batch.fbc,
        city: ctx.city,
        region: ctx.region,
        country: ctx.country,
      }));
  }

  /**
   * Regrava _stl_vid, _fbp e _fbc pelo servidor, no domínio raiz da página.
   * Cookie gravado por JavaScript o Safari corta para 7 dias; gravado pela
   * resposta do próprio domínio, vale o prazo pedido (com a ressalva de IP
   * descrita na documentação).
   */
  private setFirstPartyCookies(req: FastifyRequest, res: FastifyReply, batch: CollectBatch): string | null {
    const headers = req.headers as Headers;
    const requestHost = (header(headers, 'x-forwarded-host') || header(headers, 'host') || '')
      .split(',')[0]
      .split(':')[0]
      .toLowerCase();
    const pageHost = hostOf(header(headers, 'origin')) ?? hostOf(header(headers, 'referer'));
    const domain = sharedCookieDomain(requestHost || null, pageHost);
    if (!domain) return null;

    const cookie = (name: string, value: string, maxAge: number) =>
      `${name}=${encodeURIComponent(value)}; Max-Age=${maxAge}; Domain=${domain}; Path=/; SameSite=Lax; Secure`;

    const cookies = [cookie('_stl_vid', batch.visitorId, YEAR_S)];
    if (batch.fbp) cookies.push(cookie('_fbp', batch.fbp, FB_COOKIE_S));
    if (batch.fbc) cookies.push(cookie('_fbc', batch.fbc, FB_COOKIE_S));
    res.header('Set-Cookie', cookies);
    return domain;
  }

  /**
   * URL absoluta do /collect, montada a partir de onde o próprio script foi
   * pedido: com o snippet no subdomínio do cliente, o /collect também fica
   * nele. O host passa por uma checagem de formato antes de entrar no script.
   */
  private collectUrl(req: FastifyRequest): string {
    const headers = req.headers as Headers;
    const forwardedHost = header(headers, 'x-forwarded-host')?.split(',')[0].trim();
    const rawHost = forwardedHost || header(headers, 'host') || '';
    const host = HOST.test(rawHost) ? rawHost : 'localhost';
    const forwardedProto = header(headers, 'x-forwarded-proto')?.split(',')[0].trim();
    const proto = forwardedProto === 'http' || forwardedProto === 'https'
      ? forwardedProto
      : host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https';
    return `${proto}://${host}/api/t/collect`;
  }

  private allow(ip: string): boolean {
    const now = Date.now();

    // Limpeza preguiçosa: a instância vive enquanto está quente, e o mapa não
    // pode crescer sem fim com IPs que nunca voltam.
    if (this.hits.size > 10_000) {
      for (const [key, entry] of this.hits) {
        if (entry.resetAt <= now) this.hits.delete(key);
      }
    }

    const entry = this.hits.get(ip);
    if (!entry || entry.resetAt <= now) {
      this.hits.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
      return true;
    }
    entry.count += 1;
    return entry.count <= COLLECT_LIMIT_PER_MINUTE;
  }
}

/** O preview mostra só as requisições com evento do Meta. */
const META_EVENTS = new Set(['PageView', 'InitiateCheckout']);

const EVENT_LABEL: Record<string, string> = {
  pageview: 'PageView',
  checkout_click: 'InitiateCheckout',
  page_exit: 'Saída da página',
};

function eventLabel(e: CollectEvent): string {
  return e.type === 'custom' ? e.name ?? 'Evento' : EVENT_LABEL[e.type] ?? e.type;
}

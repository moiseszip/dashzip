#!/usr/bin/env node
/**
 * Assistente de instalação do Dash.zip. Sem dependências: Node 20+.
 *
 * Cada subcomando faz uma etapa e guarda o resultado em .setup/ (fora do Git).
 * Segredos nunca são impressos no terminal: ficam nos arquivos de .setup/.
 *
 *   node scripts/setup/dashzip-setup.mjs <comando> [--opções]
 *
 * Supabase (precisa de SUPABASE_ACCESS_TOKEN, um Personal Access Token em
 * supabase.com/dashboard/account/tokens):
 *   supabase-orgs                                  lista as organizações
 *   supabase-create --name X --org ORG [--region sa-east-1]
 *   schema                                         roda supabase/schema_completo.sql
 *   migration --file supabase/migrations/X.sql     roda uma migration (atualizações)
 *   auth --app-url https://painel.dominio.com      fecha cadastro e define as URLs do login
 *   vault --app-url https://painel.dominio.com     grava cron e Web Push no Vault
 *
 * Instância:
 *   secrets --app-url URL --email EMAIL            gera CRON_SECRET, ENCRYPTION_KEY e VAPID
 *   env --app-url URL --admin-emails a@x,b@y       monta .setup/vercel.env
 *   vercel-env [--environment production]          cadastra .setup/vercel.env na Vercel (CLI logada)
 *   admin --email EMAIL [--password SENHA]         cria o usuário admin já confirmado
 *   workspace --owner EMAIL --name NOME [--emoji 🎯] [--timezone America/Sao_Paulo]
 *   verify --app-url URL [--workspace ID]          confere painel, rastreio, webhooks e banco
 */
import { createECDH, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SETUP_DIR = join(ROOT, '.setup');
const API = 'https://api.supabase.com/v1';

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let i = 0; i < rest.length; i++) {
    const key = rest[i];
    if (!key.startsWith('--')) continue;
    const name = key.slice(2);
    const next = rest[i + 1];
    if (next === undefined || next.startsWith('--')) options[name] = true;
    else { options[name] = next; i++; }
  }
  return { command, options };
}

function fail(message) {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

function need(options, name, hint = '') {
  const value = options[name];
  if (!value || value === true) fail(`Falta --${name}${hint ? ` (${hint})` : ''}.`);
  return String(value);
}

function appUrlOf(options) {
  const raw = need(options, 'app-url', 'ex.: https://painel.seudominio.com.br');
  let url;
  try { url = new URL(raw); } catch { fail(`--app-url inválida: ${raw}`); }
  if (url.protocol !== 'https:' && url.hostname !== 'localhost') fail('--app-url precisa ser https.');
  return url.origin;
}

function readJson(name, required = true) {
  const file = join(SETUP_DIR, name);
  if (!existsSync(file)) {
    if (required) fail(`.setup/${name} não existe. Rode a etapa anterior primeiro.`);
    return null;
  }
  return JSON.parse(readFileSync(file, 'utf8'));
}

/** Grava em .setup/ com permissão só do dono (0600). */
function writeSecretFile(name, content) {
  mkdirSync(SETUP_DIR, { recursive: true });
  const file = join(SETUP_DIR, name);
  writeFileSync(file, typeof content === 'string' ? content : `${JSON.stringify(content, null, 2)}\n`);
  try { chmodSync(file, 0o600); } catch { /* Windows */ }
  return `.setup/${name}`;
}

const token = () => randomBytes(32).toString('hex');

function accessToken() {
  const value = process.env.SUPABASE_ACCESS_TOKEN;
  if (!value) fail('Defina SUPABASE_ACCESS_TOKEN (supabase.com/dashboard/account/tokens).');
  return value;
}

async function management(path, init = {}) {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${accessToken()}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!response.ok) fail(`Supabase ${init.method ?? 'GET'} ${path} → ${response.status}: ${typeof body === 'string' ? body : JSON.stringify(body)}`);
  return body;
}

function project() {
  const data = readJson('supabase.json');
  if (!data.ref) fail('.setup/supabase.json sem "ref".');
  return data;
}

async function runSql(query) {
  const { ref } = project();
  return management(`/projects/${ref}/database/query`, { method: 'POST', body: JSON.stringify({ query }) });
}

const sqlText = (value) => `'${String(value).replace(/'/g, "''")}'`;

async function serviceFetch(path, init = {}) {
  const { url, serviceRoleKey } = project();
  if (!serviceRoleKey) fail('.setup/supabase.json sem a service_role. Rode supabase-create ou preencha o arquivo.');
  const response = await fetch(`${url}${path}`, {
    ...init,
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { ok: response.ok, status: response.status, body };
}

// ---------------------------------------------------------------------------
// Supabase
// ---------------------------------------------------------------------------

async function supabaseOrgs() {
  const orgs = await management('/organizations');
  for (const org of orgs) console.log(`${org.id}\t${org.name}`);
}

async function supabaseCreate(options) {
  const name = need(options, 'name', 'nome do projeto');
  const org = need(options, 'org', 'id da organização: rode supabase-orgs');
  const region = options.region && options.region !== true ? String(options.region) : 'sa-east-1';
  const dbPassword = randomBytes(24).toString('base64url');
  const created = await management('/projects', {
    method: 'POST',
    body: JSON.stringify({ name, organization_id: org, db_pass: dbPassword, region }),
  });
  const ref = created.id ?? created.ref;
  writeSecretFile('supabase.json', { ref, url: `https://${ref}.supabase.co`, dbPassword });
  console.log(`Projeto ${ref} criado em ${region}. Aguardando ficar pronto...`);
  for (let i = 0; i < 90; i++) {
    const info = await management(`/projects/${ref}`);
    if (info.status === 'ACTIVE_HEALTHY') break;
    if (i === 89) fail(`O projeto não ficou pronto (status ${info.status}). Rode de novo mais tarde: supabase-keys --ref ${ref}`);
    await new Promise((r) => setTimeout(r, 10_000));
  }
  await supabaseKeys({ ref });
}

async function supabaseKeys(options) {
  const saved = readJson('supabase.json', false) ?? {};
  const ref = options.ref && options.ref !== true ? String(options.ref) : saved.ref;
  if (!ref) fail('Informe --ref.');
  const keys = await management(`/projects/${ref}/api-keys?reveal=true`);
  const find = (name) => keys.find((key) => key.name === name)?.api_key;
  const anonKey = find('anon');
  const serviceRoleKey = find('service_role');
  if (!anonKey || !serviceRoleKey) fail('Não encontrei as chaves anon e service_role (Legacy API Keys) do projeto.');
  const file = writeSecretFile('supabase.json', { ...saved, ref, url: `https://${ref}.supabase.co`, anonKey, serviceRoleKey });
  console.log(`✔ Chaves do projeto ${ref} em ${file}.`);
}

async function schema() {
  const sql = readFileSync(join(ROOT, 'supabase', 'schema_completo.sql'), 'utf8');
  await runSql(sql);
  console.log('✔ supabase/schema_completo.sql aplicado.');
}

async function migration(options) {
  const file = resolve(ROOT, need(options, 'file', 'supabase/migrations/AAAAMMDDHHMMSS_nome.sql'));
  if (!file.startsWith(join(ROOT, 'supabase'))) fail('A migration precisa estar em supabase/.');
  await runSql(readFileSync(file, 'utf8'));
  console.log(`✔ ${file.slice(ROOT.length + 1)} aplicada.`);
}

async function auth(options) {
  const appUrl = appUrlOf(options);
  const { ref } = project();
  await management(`/projects/${ref}/config/auth`, {
    method: 'PATCH',
    body: JSON.stringify({ disable_signup: true, site_url: appUrl, uri_allow_list: `${appUrl}/**` }),
  });
  console.log(`✔ Cadastro público fechado; login e "esqueci a senha" voltam para ${appUrl}.`);
}

async function vault(options) {
  const appUrl = appUrlOf(options);
  const secrets = readJson('secrets.json');
  const entries = [
    ['dash_rules_cron_url', `${appUrl}/api/rules-cron/tick`],
    ['dash_cron_secret', secrets.CRON_SECRET],
    ['dash_sales_web_push_vapid', JSON.stringify(secrets.vapid)],
  ];
  const names = entries.map(([name]) => sqlText(name)).join(', ');
  const sql = [
    `DELETE FROM vault.secrets WHERE name IN (${names});`,
    ...entries.map(([name, value]) => `SELECT vault.create_secret(${sqlText(value)}, ${sqlText(name)});`),
  ].join('\n');
  await runSql(sql);
  console.log('✔ Vault: URL do cron, segredo do cron e chaves do Web Push gravados.');
}

// ---------------------------------------------------------------------------
// Instância
// ---------------------------------------------------------------------------

function vapidKeys(email) {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    publicKey: ecdh.getPublicKey().toString('base64url'),
    privateKey: ecdh.getPrivateKey().toString('base64url'),
    subject: `mailto:${email}`,
  };
}

function secretsCommand(options) {
  appUrlOf(options);
  const email = need(options, 'email', 'e-mail do responsável, vai no Web Push');
  const existing = readJson('secrets.json', false);
  if (existing && !options.force) {
    console.log('✔ .setup/secrets.json já existe (use --force só se ainda não estiver em produção).');
    return;
  }
  const file = writeSecretFile('secrets.json', {
    CRON_SECRET: token(),
    ENCRYPTION_KEY: token(),
    vapid: vapidKeys(email),
  });
  console.log(`✔ Segredos gerados em ${file}. Não troque ENCRYPTION_KEY depois que tokens forem salvos.`);
}

function envCommand(options) {
  const appUrl = appUrlOf(options);
  const admins = need(options, 'admin-emails', 'e-mails dos admins, separados por vírgula');
  const supabase = project();
  const secrets = readJson('secrets.json');
  if (!supabase.anonKey || !supabase.serviceRoleKey) fail('.setup/supabase.json sem anonKey/serviceRoleKey.');
  const lines = {
    SUPABASE_URL: supabase.url,
    SUPABASE_ANON_KEY: supabase.anonKey,
    SUPABASE_SERVICE_ROLE_KEY: supabase.serviceRoleKey,
    ADMIN_EMAILS: admins,
    APP_URL: appUrl,
    CRON_SECRET: secrets.CRON_SECRET,
    ENCRYPTION_KEY: secrets.ENCRYPTION_KEY,
  };
  const file = writeSecretFile('vercel.env', `${Object.entries(lines).map(([k, v]) => `${k}=${v}`).join('\n')}\n`);
  console.log(`✔ ${file} com ${Object.keys(lines).join(', ')}.`);
}

function vercelEnv(options) {
  const environment = options.environment && options.environment !== true ? String(options.environment) : 'production';
  const file = join(SETUP_DIR, 'vercel.env');
  if (!existsSync(file)) fail('.setup/vercel.env não existe. Rode o comando env.');
  const entries = readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => {
    const at = line.indexOf('=');
    return [line.slice(0, at), line.slice(at + 1)];
  });
  for (const [key, value] of entries) {
    spawnSync('vercel', ['env', 'rm', key, environment, '--yes'], { cwd: ROOT, stdio: 'ignore' });
    const result = spawnSync('vercel', ['env', 'add', key, environment], { cwd: ROOT, input: value, stdio: ['pipe', 'ignore', 'pipe'] });
    if (result.status !== 0) fail(`vercel env add ${key} falhou: ${result.stderr?.toString().trim() || 'confira vercel login e vercel link'}`);
    console.log(`✔ ${key}`);
  }
  console.log(`Variáveis cadastradas em ${environment}. Publique de novo (vercel --prod) para valerem.`);
}

async function admin(options) {
  const email = need(options, 'email').toLowerCase();
  const password = options.password && options.password !== true ? String(options.password) : `${randomBytes(9).toString('base64url')}#9a`;
  const created = await serviceFetch('/auth/v1/admin/users', {
    method: 'POST',
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  if (!created.ok && !/already|registered|exists/i.test(JSON.stringify(created.body))) {
    fail(`Não foi possível criar ${email}: ${created.status} ${JSON.stringify(created.body)}`);
  }
  if (created.ok) {
    const file = writeSecretFile('admin.json', { email, password });
    console.log(`✔ Admin ${email} criado. Senha inicial em ${file}: peça para trocar no primeiro acesso.`);
  } else {
    console.log(`✔ ${email} já existia.`);
  }
}

async function userIdByEmail(email) {
  for (let page = 1; page <= 20; page++) {
    const { ok, body } = await serviceFetch(`/auth/v1/admin/users?page=${page}&per_page=100`);
    if (!ok) fail('Não consegui listar os usuários com a service_role.');
    const found = body.users?.find((user) => user.email?.toLowerCase() === email);
    if (found) return found.id;
    if (!body.users?.length) break;
  }
  fail(`Usuário ${email} não existe. Rode o comando admin antes.`);
}

async function workspace(options) {
  const owner = need(options, 'owner', 'e-mail do dono do painel').toLowerCase();
  const name = need(options, 'name', 'nome do painel');
  const timezone = options.timezone && options.timezone !== true ? String(options.timezone) : 'America/Sao_Paulo';
  const userId = await userIdByEmail(owner);
  const row = { user_id: userId, name, timezone, ...(options.emoji && options.emoji !== true ? { emoji: String(options.emoji) } : {}) };
  const { ok, status, body } = await serviceFetch('/rest/v1/workspaces', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(row),
  });
  if (!ok) fail(`Não foi possível criar o painel: ${status} ${JSON.stringify(body)}`);
  console.log(`✔ Painel "${name}" criado: ${body[0].id}`);
}

// ---------------------------------------------------------------------------
// Verificação
// ---------------------------------------------------------------------------

async function check(label, run) {
  try {
    const detail = await run();
    console.log(`✅ ${label}${detail ? ` — ${detail}` : ''}`);
    return true;
  } catch (error) {
    console.log(`❌ ${label} — ${error.message}`);
    return false;
  }
}

async function verify(options) {
  const appUrl = appUrlOf(options);
  const results = [];
  results.push(await check('Painel no ar (/health)', async () => {
    const body = await (await fetch(`${appUrl}/health`)).json();
    if (body.status !== 'ok') throw new Error(`status ${body.status}: confira as chaves do Supabase na Vercel e se o schema rodou`);
    return `banco a ${body.db_latency_ms} ms`;
  }));
  results.push(await check('Coletor de rastreio (/api/t/ping)', async () => {
    const body = await (await fetch(`${appUrl}/api/t/ping`)).json();
    if (body.service !== 'dashzip-tracking') throw new Error(`resposta inesperada: ${JSON.stringify(body)}`);
  }));
  if (options.workspace && options.workspace !== true) {
    results.push(await check('Script do snippet (/api/t/tracker.js)', async () => {
      const text = await (await fetch(`${appUrl}/api/t/tracker.js?tid=${options.workspace}`)).text();
      if (text.includes('area desconhecida')) throw new Error('painel não encontrado: confira o --workspace');
      if (!text.includes('collect')) throw new Error('script inesperado');
    }));
  }
  results.push(await check('Webhooks dos checkouts (/api/webhooks/:checkout)', async () => {
    const response = await fetch(`${appUrl}/api/webhooks/hotmart`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    if (response.status >= 500) throw new Error(`HTTP ${response.status}`);
    return `responde ${response.status} sem token (esperado)`;
  }));
  if (readJson('supabase.json', false)?.serviceRoleKey) {
    results.push(await check('Banco: Vault, cron e Web Push', async () => {
      const { ok, status, body } = await serviceFetch('/rest/v1/rpc/dashzip_setup_status', { method: 'POST', body: '{}' });
      if (!ok) throw new Error(`HTTP ${status}: rode o schema completo`);
      const missing = ['cron_url', 'cron_secret', 'web_push_keys'].filter((key) => !body[key]);
      if (missing.length) throw new Error(`faltando ${missing.join(', ')}: rode o comando vault`);
      if (!body.cron_jobs?.length) throw new Error('nenhum agendamento dash-*: confira as extensões pg_cron e pg_net');
      return `${body.cron_jobs.length} agendamentos, ${body.workspaces} painel(is)`;
    }));
  }
  const failed = results.filter((ok) => !ok).length;
  console.log(failed ? `\n${failed} verificação(ões) falharam.` : '\nTudo certo. Próximo: snippet na página, webhook no checkout e um evento de teste no Preview e debug.');
  process.exit(failed ? 1 : 0);
}

// ---------------------------------------------------------------------------

const COMMANDS = {
  'supabase-orgs': supabaseOrgs,
  'supabase-create': supabaseCreate,
  'supabase-keys': supabaseKeys,
  schema,
  migration,
  auth,
  vault,
  secrets: secretsCommand,
  env: envCommand,
  'vercel-env': vercelEnv,
  admin,
  workspace,
  verify,
};

const { command, options } = parseArgs(process.argv.slice(2));
if (!command || command === 'help' || options.help || !COMMANDS[command]) {
  const header = readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0];
  console.log(header.replace(/^#!.*\n\/\*\*\n?/, '').replace(/^ \* ?/gm, ''));
  process.exit(command && command !== 'help' && !options.help ? 1 : 0);
}
await COMMANDS[command](options);

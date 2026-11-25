import { useEffect, useState, type ComponentType } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BarChart3, Bell, Box, DollarSign, Flame, FlaskConical, Megaphone, Radar, Receipt, Rocket, Sparkles,
} from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';

interface TourStep {
  icon: ComponentType<{ className?: string }>;
  title: string;
  body: string;
  /** Tela da seção: o tutorial abre a tela ao chegar na etapa. */
  to?: string;
}

/** As seções do Dash.zip, na ordem do menu. */
export const TOUR_STEPS: TourStep[] = [
  {
    icon: Sparkles,
    title: 'Boas-vindas ao Dash.zip',
    body: 'Rastreio first-party, vendas, mídia e resultado da operação num painel só. Em um minuto você conhece cada seção.',
  },
  {
    icon: Box,
    title: 'Painéis',
    body: 'Cada oferta ou operação é um painel, com snippet, pixel, webhooks e preview próprios. Troque de painel pelo seletor no menu ou pelo atalho Painéis no celular.',
    to: '/settings?tab=dashboards',
  },
  {
    icon: BarChart3,
    title: 'Resultado',
    body: 'Faturamento, lucro, ROI, margem e gráficos do período. Toque no lápis para escolher os cards e montar a sua visão.',
    to: '/finance',
  },
  {
    icon: Megaphone,
    title: 'Campanhas',
    body: 'Campanhas, conjuntos e anúncios do Meta com as vendas do painel ao lado. Pause, ative e ajuste orçamento sem sair daqui.',
    to: '/campaigns/meta',
  },
  {
    icon: FlaskConical,
    title: 'Acompanhamento de testes',
    body: 'Agrupa as campanhas por oferta e mostra quais criativos e testes estão vendendo.',
    to: '/tests',
  },
  {
    icon: DollarSign,
    title: 'Vendas',
    body: 'Cada pedido que chega dos checkouts, com status, meio de pagamento, origem e envio ao Meta.',
    to: '/sales',
  },
  {
    icon: Receipt,
    title: 'Custos',
    body: 'Impostos, taxas do checkout, custo de produto e despesas. É daqui que sai o lucro real.',
    to: '/costs',
  },
  {
    icon: Flame,
    title: 'Hotjar',
    body: 'Rolagem, cliques, mapa de calor, quiz e tempo até a compra em cada página de venda.',
    to: '/hotjar',
  },
  {
    icon: Radar,
    title: 'Tracking',
    body: 'Integrações liga checkout, pixel e API de Conversões. Preview e debug mostra cada evento no navegador e no servidor. Ao vivo mostra quem está na página agora.',
    to: '/integrations',
  },
  {
    icon: Bell,
    title: 'Configurações',
    body: 'Fuso do painel, notificações de venda no celular, usuários da equipe, segurança da conta e modo streaming para gravar a tela sem expor dados.',
    to: '/settings',
  },
  {
    icon: Rocket,
    title: 'Por onde começar',
    body: 'Crie o painel da sua oferta, conecte o checkout e o pixel em Integrações e confira o primeiro evento no Preview e debug.',
    to: '/integrations',
  },
];

const storageKey = (userId: string) => `dashzip:tour-done:${userId}`;

function readDone(userId: string) {
  try { return localStorage.getItem(storageKey(userId)) === '1'; } catch { return true; }
}

function markDone(userId: string) {
  try { localStorage.setItem(storageKey(userId), '1'); } catch { /* navegação privada */ }
}

/** Abre o tutorial de novo (Configurações → Conta). */
export function restartWelcomeTour() {
  window.dispatchEvent(new Event('dashzip:tour'));
}

/**
 * Tutorial das seções, no primeiro acesso de cada usuário neste aparelho.
 * Cada etapa abre a tela da seção por trás (avançar e voltar trocam de tela).
 * Fecha no X, no "Pular" ou no fim, e fica na tela em que estiver.
 */
export function WelcomeTour() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (user?.id && !readDone(user.id)) setOpen(true);
  }, [user?.id]);

  useEffect(() => {
    const show = () => { setIndex(0); setOpen(true); };
    window.addEventListener('dashzip:tour', show);
    return () => window.removeEventListener('dashzip:tour', show);
  }, []);

  const close = () => {
    if (user?.id) markDone(user.id);
    setOpen(false);
  };

  const goTo = (next: number) => {
    setIndex(next);
    const to = TOUR_STEPS[next].to;
    if (to) navigate(to);
  };

  const step = TOUR_STEPS[index];
  const last = index === TOUR_STEPS.length - 1;
  const Icon = step.icon;

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
      <DialogContent className="gap-5 sm:max-w-md">
        <div key={index} className="animate-page-in space-y-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-foreground/10">
            <Icon className="h-6 w-6" />
          </div>
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">{index + 1} de {TOUR_STEPS.length}</p>
            <DialogTitle className="text-lg font-semibold">{step.title}</DialogTitle>
            <DialogDescription className="text-sm leading-relaxed text-muted-foreground">{step.body}</DialogDescription>
          </div>
        </div>

        <div className="flex justify-center gap-1.5" aria-hidden="true">
          {TOUR_STEPS.map((item, i) => (
            <span
              key={item.title}
              className={cn('h-1.5 rounded-full transition-all duration-200', i === index ? 'w-5 bg-foreground' : 'w-1.5 bg-foreground/20')}
            />
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button variant="ghost" className="min-h-11" onClick={close}>{last ? 'Fechar' : 'Pular'}</Button>
          <div className="flex gap-2">
            {index > 0 && (
              <Button variant="outline" className="min-h-11" onClick={() => goTo(index - 1)}>Voltar</Button>
            )}
            <Button className="min-h-11" onClick={() => (last ? close() : goTo(index + 1))}>
              {last ? 'Começar' : 'Próximo'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

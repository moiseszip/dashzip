import { ListChecks } from 'lucide-react';
import { pct, stepLabel, type QuizFunnel } from '@/lib/hotjar';
import { Section, Stat } from './Section';

/** Funil do quiz: quantos chegaram em cada etapa e quantos avançaram. */
export function QuizSection({ quiz }: { quiz: QuizFunnel | null }) {
  if (!quiz) {
    return (
      <Section icon={ListChecks} title="Quiz" description="Funil por etapa">
        <p className="text-sm text-muted-foreground">
          Nenhuma etapa registrada no período. A página do quiz manda cada etapa com{' '}
          <code className="rounded bg-foreground/5 px-1 text-xs">dashzip('track', 'quiz_step', {'{'} step, index {'}'})</code>.
        </p>
      </Section>
    );
  }
  const finishedRate = quiz.started ? (quiz.finished / quiz.started) * 100 : null;
  return (
    <Section icon={ListChecks} title="Quiz" description="Quantos chegaram em cada etapa e quantos avançaram para a próxima">
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Começaram" value={quiz.started.toLocaleString('pt-BR')} />
        <Stat label="Chegaram ao fim" value={quiz.finished.toLocaleString('pt-BR')} note={stepLabel(quiz.steps[quiz.steps.length - 1]?.step ?? '')} />
        <Stat label="Conclusão" value={pct(finishedRate)} />
      </div>
      <ol className="space-y-1.5">
        {quiz.steps.map((s) => {
          const worst = quiz.worstStep === s.step;
          return (
            <li key={s.step} className="text-xs">
              <div className="flex items-center gap-2">
                <span className="w-5 shrink-0 text-right tabular-nums text-muted-foreground">{s.index + 1}</span>
                <span className="w-24 shrink-0 truncate sm:w-32" title={s.step}>{stepLabel(s.step)}</span>
                <div className="h-4 min-w-0 flex-1 overflow-hidden rounded bg-foreground/5">
                  <div className="h-full rounded" style={{ width: `${s.ofStart}%`, background: 'var(--viz-1)' }} />
                </div>
                <span className="w-12 shrink-0 text-right tabular-nums">{s.sessions.toLocaleString('pt-BR')}</span>
                <span className="w-10 shrink-0 text-right tabular-nums text-muted-foreground">{pct(s.ofStart)}</span>
              </div>
              {s.advanced !== null && (
                <p className={worst ? 'ml-7 mt-0.5 text-destructive' : 'ml-7 mt-0.5 text-muted-foreground'}>
                  ↓ {pct(s.advanced)} avançaram{worst ? ' · etapa que mais perde gente' : ''}
                </p>
              )}
            </li>
          );
        })}
      </ol>
      <p className="text-xs text-muted-foreground">
        Sessões únicas. Quem recarregou e caiu direto numa etapa adiante conta nas anteriores.
      </p>
    </Section>
  );
}

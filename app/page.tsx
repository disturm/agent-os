'use client';

import { ExclamationTriangleIcon } from '@radix-ui/react-icons';
import { useState, type CSSProperties } from 'react';

import { AgentForm } from '@/components/AgentForm';
import { PlanView } from '@/components/PlanView';
import { ReviewPanel } from '@/components/ReviewPanel';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import type { AgentResult } from '@/lib/agent-result';

type State =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'result'; result: AgentResult }
  | { status: 'error'; message: string };

export default function Page() {
  const [task, setTask] = useState('');
  const [state, setState] = useState<State>({ status: 'idle' });

  async function runAgent() {
    setState({ status: 'running' });
    try {
      const response = await fetch('/api/agent/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? `Ошибка ${response.status}`);
      setState({ status: 'result', result: data as AgentResult });
    } catch (err: unknown) {
      setState({ status: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }

  const running = state.status === 'running';
  const result = state.status === 'result' ? state.result : null;
  const blocked = result?.review.verdict === 'needs_human_professional';

  return (
    <div className="mx-auto max-w-6xl px-6 py-12 lg:py-16">
      <header className="flex items-start justify-between gap-6 border-b border-border pb-8">
        <div>
          <h1 className="font-serif text-4xl tracking-[-0.03em] text-primary lg:text-5xl">
            Wellness-агент
            <span aria-hidden className="ml-2 inline-block size-2 -translate-y-[0.15em] rounded-[2px] bg-brand" />
          </h1>
          <p className="mt-3 max-w-xl text-sm text-muted-foreground">
            Коуч по питанию, тренировкам и восстановлению. Каждый план проходит обязательную проверку безопасности.
            Это не медицинский продукт: диагнозы, лекарства и дозировки вне его компетенции.
          </p>
        </div>
        <ThemeToggle />
      </header>

      <main className="grid gap-10 pt-10 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)] lg:gap-16">
        <div className="space-y-8 lg:sticky lg:top-12 lg:self-start">
          <AgentForm task={task} onTaskChange={setTask} onSubmit={runAgent} running={running} />
          {result && <ReviewPanel result={result} />}
        </div>

        <section aria-live="polite" aria-busy={running}>
          <h2 className="mb-5 text-xs font-medium tracking-[0.12em] text-muted-foreground uppercase">
            {blocked ? 'Ответ агента' : 'План'}
          </h2>

          {state.status === 'idle' && <EmptyState />}
          {running && <RunningState />}
          {state.status === 'error' && <ErrorState message={state.message} />}
          {blocked && <BlockedState />}
          {result && !blocked && <PlanView plan={result.plan} />}
        </section>
      </main>
    </div>
  );
}

/** До первого запуска правая колонка объясняет, как устроен прогон. */
function EmptyState() {
  const steps = [
    ['Health Coach', 'Сам берёт профиль, дневник и рецепты инструментами и пишет план под задачу.'],
    ['Safety Reviewer', 'Видит только план, проверяет границы wellness и ставит оценку до 10.'],
    ['Revision loop', 'До трёх раундов правок; одобренный план агент сохраняет в output.md.'],
  ];

  return (
    <ol className="max-w-lg divide-y divide-border border-y border-border">
      {steps.map(([title, description], index) => (
        <li key={title} className="enter flex gap-4 py-4" style={{ '--index': index } as CSSProperties}>
          <span className="font-mono text-xs text-brand">{String(index + 1).padStart(2, '0')}</span>
          <div>
            <p className="text-sm font-medium">{title}</p>
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

function RunningState() {
  return (
    <div className="max-w-2xl space-y-3" aria-label="Агент работает">
      <Skeleton className="h-6 w-1/3 rounded-sm bg-secondary" />
      <Skeleton className="h-4 w-full rounded-sm bg-secondary" />
      <Skeleton className="h-4 w-11/12 rounded-sm bg-secondary" />
      <Skeleton className="h-4 w-4/5 rounded-sm bg-secondary" />
      <Skeleton className="mt-8 h-6 w-1/4 rounded-sm bg-secondary" />
      <Skeleton className="h-4 w-full rounded-sm bg-secondary" />
      <Skeleton className="h-4 w-3/4 rounded-sm bg-secondary" />
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <Alert variant="destructive" className="enter max-w-2xl rounded-lg shadow-none">
      <ExclamationTriangleIcon />
      <AlertTitle className="line-clamp-none">Прогон не завершился</AlertTitle>
      <AlertDescription className="font-mono text-xs break-all">{message}</AlertDescription>
    </Alert>
  );
}

/** Предохранитель: при needs_human_professional план не показывается вообще. */
function BlockedState() {
  return (
    <Alert className="enter max-w-2xl rounded-lg border-transparent bg-stop text-stop-foreground shadow-none">
      <ExclamationTriangleIcon />
      <AlertTitle className="line-clamp-none text-base">Этот запрос требует консультации специалиста</AlertTitle>
      <AlertDescription className="text-stop-foreground/80">
        Safety Reviewer остановил прогон: задача выходит за границы wellness-коучинга. Обратитесь к врачу или
        профильному специалисту — план не составлялся.
      </AlertDescription>
    </Alert>
  );
}

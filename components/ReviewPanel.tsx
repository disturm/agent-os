import { DotFilledIcon, TriangleRightIcon } from '@radix-ui/react-icons';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { TOOL_META, VERDICT_META, formatDuration, splitToolCall, type AgentResult } from '@/lib/agent-result';

type ReviewPanelProps = {
  result: AgentResult;
};

/** Итог safety review: вердикт, оценка, история раундов, замечания и параметры прогона. */
export function ReviewPanel({ result }: ReviewPanelProps) {
  const { review, rounds, finalRound, finalScore, improved, toolCalls, promptVersions, durationMs } = result;
  const meta = VERDICT_META[review.verdict];

  return (
    <Card className="enter gap-0 rounded-xl border-border bg-card py-0 shadow-none">
      <CardContent className="px-5 py-5">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-xs font-medium tracking-[0.12em] text-muted-foreground uppercase">Safety review</h2>
          <Badge className={`${meta.badge} tracking-[0.08em] uppercase`}>{review.verdict}</Badge>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">{meta.gloss}</p>
      </CardContent>

      <Separator />

      <CardContent className="px-5 py-5">
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-muted-foreground">Оценка</span>
          <span className="font-mono text-sm text-foreground">
            {finalScore}
            <span className="text-muted-foreground">/10</span>
          </span>
        </div>
        {/* Заливку индикатора shadcn жёстко ставит в bg-primary — перекрываем снаружи, не трогая примитив. */}
        <Progress
          value={finalScore * 10}
          className="mt-3 h-1 rounded-none bg-secondary [&>[data-slot=progress-indicator]]:bg-brand"
        />

        <div className="mt-5 flex items-baseline justify-between">
          <span className="text-sm text-muted-foreground">Раундов доработки</span>
          <span className="font-mono text-sm text-foreground">{rounds.length}</span>
        </div>
        {improved && <p className="mt-1 text-xs text-muted-foreground">Оценка выросла за время доработок.</p>}

        {/* История свёрнута: в норме интересен только итог, разбор раундов — по запросу. */}
        <details className="group mt-4">
          <summary className="flex cursor-pointer list-none items-center gap-1 text-xs text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
            <TriangleRightIcon className="size-4 transition-transform group-open:rotate-90" />
            История раундов
          </summary>
          <ol className="mt-3 space-y-2 border-l border-border pl-3">
            {rounds.map((state) => (
              <li key={state.round} className="flex items-baseline justify-between gap-3 text-xs">
                <span className="text-muted-foreground">
                  Раунд {state.round}
                  {/* Итоговым может быть не последний раунд: доработка сверх минимума одобренный план не отменяет. */}
                  {state.round === finalRound && rounds.length > 1 && (
                    <span className="ml-1.5 text-brand">← итог</span>
                  )}
                </span>
                <span className="font-mono text-foreground">
                  {state.review.verdict}
                  <span className="text-muted-foreground"> · {state.review.score}/10</span>
                </span>
              </li>
            ))}
          </ol>
        </details>
      </CardContent>

      <Separator />

      {/* Данные агент собирает сам, инструментами — без этого списка прогон выглядел бы чёрным ящиком. */}
      <CardContent className="px-5 py-5">
        <h3 className="text-xs font-medium tracking-[0.12em] text-muted-foreground uppercase">
          Что сделал агент
          <span className="ml-2 font-mono tracking-normal normal-case">{toolCalls.length}</span>
        </h3>

        {toolCalls.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">Инструменты не понадобились.</p>
        ) : (
          <ol className="mt-3 space-y-2">
            {toolCalls.map((entry, index) => {
              const { source, name } = splitToolCall(entry);
              return (
                <li key={`${index}-${entry}`} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
                  <span className="font-mono text-xs text-brand">{String(index + 1).padStart(2, '0')}</span>
                  {/* Источник: с какого MCP-сервера пришёл инструмент или `local`. Старые записи его не имеют. */}
                  {source && (
                    <span className="rounded-sm bg-secondary px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                      {source}
                    </span>
                  )}
                  <span className="font-mono text-[13px] text-foreground">{name}</span>
                  {/* Незнакомое имя показываем как есть: набор инструментов меняется чаще, чем UI. */}
                  <span className="text-xs text-muted-foreground">{TOOL_META[name] ?? ''}</span>
                </li>
              );
            })}
          </ol>
        )}
      </CardContent>

      <Separator />

      <CardContent className="px-5 py-5">
        <h3 className="text-xs font-medium tracking-[0.12em] text-muted-foreground uppercase">
          Замечания
          <span className="ml-2 font-mono tracking-normal normal-case">{review.issues.length}</span>
        </h3>

        {review.issues.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">Ревьюер не нашёл нарушений.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {review.issues.map((issue, index) => (
              <li key={index} className="flex gap-1.5 text-sm leading-relaxed">
                <DotFilledIcon className="mt-1 size-3.5 shrink-0 text-muted-foreground" />
                <span>{issue}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <Separator />

      {/* Параметры прогона: по ним ответ соотносится с версией промптов и стоимостью цикла. */}
      <CardContent className="px-5 py-4">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-xs">
          <dt className="text-muted-foreground">Время прогона</dt>
          <dd className="text-right font-mono text-foreground">{formatDuration(durationMs)}</dd>
          <dt className="text-muted-foreground">Промпты</dt>
          <dd className="text-right font-mono text-foreground">
            coach {promptVersions.coach}
            <span className="text-muted-foreground"> · </span>
            reviewer {promptVersions.reviewer}
          </dd>
        </dl>
      </CardContent>
    </Card>
  );
}

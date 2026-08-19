/**
 * Итог прогона под планом: вердикт, оценка, раунды, время и версии промптов.
 *
 * Полной истории раундов здесь нет намеренно: в чате её место занял таймлайн, а тексты
 * всех черновиков остались там, где им и место, — в трейсе `runs/run-*.json`.
 */

import { formatDuration, VERDICT_META } from '@/lib/agent-result';
import type { SummaryData } from '@/lib/chat-stream';

export function RunSummary({ verdict, score, finalRound, totalRounds, durationMs, promptVersions }: SummaryData) {
  const meta = VERDICT_META[verdict];

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border pt-3 text-xs text-muted-foreground">
      <span className={`rounded-sm px-2 py-1 font-mono ${meta.badge}`}>{verdict}</span>
      <span>{meta.gloss}</span>
      <span className="font-mono">{score}/10</span>
      {/* Итоговым может оказаться не последний раунд — см. finalRound в harness. */}
      <span>
        раунд {finalRound} из {totalRounds}
      </span>
      <span>{formatDuration(durationMs)}</span>
      <span className="font-mono">
        coach {promptVersions.coach} · reviewer {promptVersions.reviewer}
      </span>
    </div>
  );
}

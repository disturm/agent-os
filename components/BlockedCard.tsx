/**
 * Предохранитель: вердикт `needs_human_professional`.
 *
 * Плана в этом случае не существует — не «есть, но спрятан». Поэтому карточка занимает
 * его место целиком, а не приписывается сверху: показать рядом черновик значило бы
 * обойти ровно ту границу, ради которой предохранитель и стоит.
 */

import type { BlockedData } from '@/lib/chat-stream';

export function BlockedCard({ issues }: BlockedData) {
  return (
    <div className="rounded-lg bg-stop p-4 text-stop-foreground">
      <p className="font-medium">Этот запрос требует консультации специалиста</p>
      <p className="mt-1.5 text-sm text-stop-foreground/80">
        Safety Reviewer остановил прогон: задача выходит за границы wellness-коучинга. Обратитесь к врачу или
        профильному специалисту — план не составлялся.
      </p>
      {issues.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm text-stop-foreground/80">
          {issues.map((issue) => (
            <li key={issue} className="before:mr-1.5 before:content-['—']">
              {issue}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

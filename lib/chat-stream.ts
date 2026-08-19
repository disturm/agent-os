/**
 * Форма данных, которые чат получает из `POST /api/chat` (`docs/spec9.md`).
 *
 * Роут и страница читают её отсюда оба, поэтому она описана один раз — ровно как вердикт
 * в `agent-result.ts`. Названия частей (`step`, `tool`, `summary`, `blocked`) становятся
 * типами `data-step`, `data-tool` и так далее: так их адресует AI SDK, и по `id` части
 * обновляются на месте, не плодя строк таймлайна.
 *
 * Событий harness (`src/harness/runEvents.ts`) здесь нет намеренно: `lib/` не импортирует
 * `src/`, и это по-прежнему граница между сервером и клиентом. Перевод одного в другое живёт
 * в единственном месте — `app/api/chat/timeline.ts`.
 */

import type { UIMessage } from 'ai';
import type { PromptVersions, Verdict } from './agent-result';

/**
 * Состояние шага. `pending` — шаг объявлен, но ещё не начинался: этапы круга объявляются
 * сразу все, чтобы порядок в таймлайне задавала спека, а не случайность момента.
 * `skipped` — до шага дело так и не дошло (коуч, например, не искал в базе знаний):
 * молча прятать его нельзя, «не искал» — это факт прогона.
 */
export type StepStatus = 'pending' | 'running' | 'done' | 'skipped';

export type StepData = {
  /** Название этапа из `docs/spec9.md`: «Reading profile», «Reviewing safety» и далее. */
  label: string;
  status: StepStatus;
  /** Приписка справа: запросы к базе знаний, вердикт со счётом. */
  detail?: string;
  /** Замечания ревьюера — только у шага проверки. */
  issues?: string[];
};

export type ToolData = {
  name: string;
  /** Имя MCP-сервера либо `local` — в той же форме, в какой harness метит `toolCalls`. */
  source: string;
  /** `id` шага, под которым рисуется строка: вызовы группируются по этапам. */
  step: string;
  /** Только у `searchKnowledge`: с чем ходили в базу знаний и что нашли. */
  query?: string;
  headings?: string[];
};

/** Итог прогона под текстом плана. Полную историю раундов чат не показывает — она в трейсе. */
export type SummaryData = {
  verdict: Verdict;
  score: number;
  finalRound: number;
  totalRounds: number;
  durationMs: number;
  promptVersions: PromptVersions;
};

/** Предохранитель: вместо плана — карточка со ссылкой на специалиста. */
export type BlockedData = { issues: string[] };

export type ChatDataParts = {
  step: StepData;
  tool: ToolData;
  summary: SummaryData;
  blocked: BlockedData;
};

export type ChatMessage = UIMessage<unknown, ChatDataParts>;
export type ChatMessagePart = ChatMessage['parts'][number];

/** Плашка источника: `local` — свой `tool()`, всё остальное — имя MCP-сервера из конфига. */
export const LOCAL_SOURCE = 'local';

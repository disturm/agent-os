/**
 * Форма ответа `POST /api/agent/run` и оформление вердиктов.
 * Живёт отдельно от компонентов: и левая колонка (ReviewPanel), и правая (PlanView)
 * читают один и тот же вердикт, дублировать его описание в двух местах нельзя.
 */

export type Verdict = 'approve' | 'revise' | 'needs_human_professional';

export type Review = {
  verdict: Verdict;
  score: number;
  issues: string[];
};

/** Один проход коуч → ревьюер; зеркалит `RoundState` из `src/harness/rounds.ts`. */
export type RoundState = {
  round: number;
  plan: string;
  review: Review;
};

/** Версии промптов, на которых сделан прогон. */
export type PromptVersions = {
  coach: string;
  reviewer: string;
};

export type AgentResult = {
  plan: string;
  review: Review;
  rounds: RoundState[];
  /** Номер раунда, ставшего итогом: он может быть не последним в истории. */
  finalRound: number;
  finalScore: number;
  improved: boolean;
  /** Инструменты, вызванные коучем за прогон, по порядку. Повторы не схлопнуты. */
  toolCalls: string[];
  promptVersions: PromptVersions;
  durationMs: number;
};

/** Что делает инструмент — человеческой строкой: имя из API само по себе объясняет мало. */
export const TOOL_META: Record<string, string> = {
  getProfile: 'прочитал профиль',
  getRecentLog: 'заглянул в дневник',
  listFavoriteRecipes: 'посмотрел рецепты',
  suggestWorkoutTemplate: 'взял шаблон тренировки',
  generateShoppingList: 'собрал список покупок',
  savePlan: 'сохранил план',
};

/** Длительность прогона в секундах: миллисекунды тут ничего не решают. */
export function formatDuration(durationMs: number): string {
  return `${(durationMs / 1000).toFixed(1)} с`;
}

type VerdictMeta = {
  /** Русская расшифровка: сырой токен вердикта сам по себе ничего не объясняет. */
  gloss: string;
  /** Классы бейджа — пастельная пара фон/текст из палитры. */
  badge: string;
};

export const VERDICT_META: Record<Verdict, VerdictMeta> = {
  approve: {
    gloss: 'План одобрен ревьюером',
    badge: 'bg-approve text-approve-foreground',
  },
  revise: {
    gloss: 'Замечания не сняты за три раунда',
    badge: 'bg-revise text-revise-foreground',
  },
  needs_human_professional: {
    gloss: 'Запрос выходит за границы wellness',
    badge: 'bg-stop text-stop-foreground',
  },
};

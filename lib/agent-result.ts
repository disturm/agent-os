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
  /**
   * Инструменты, вызванные коучем за прогон, по порядку. Повторы не схлопнуты.
   * Каждая запись — `[источник] имя`, разбирается через `splitToolCall`.
   */
  toolCalls: string[];
  promptVersions: PromptVersions;
  durationMs: number;
};

/**
 * Разбор записи `toolCalls`: `[weather] weather_forecast` → источник и имя.
 *
 * Источник — имя MCP-сервера из `src/mcp/servers.config.ts` либо `local`. Формат задаёт
 * harness (`src/harness/toolCalls.ts`); здесь он только разбирается обратно. Запись без
 * префикса (трейс до `docs/spec7.md`) отдаётся с пустым источником — UI просто не покажет
 * плашку, вместо того чтобы соврать про происхождение.
 */
export function splitToolCall(entry: string): { source: string; name: string } {
  const match = /^\[([^\]]+)]\s+(.+)$/.exec(entry);
  return match ? { source: match[1], name: match[2] } : { source: '', name: entry };
}

/**
 * Что делает инструмент — человеческой строкой: имя из API само по себе объясняет мало.
 *
 * Откуда инструмент пришёл, писать здесь больше не нужно: источник виден плашкой из
 * `splitToolCall`. Для агента разницы всё равно нет — MCP-инструмент и локальный `tool()`
 * вызываются одинаково и лежат в одном `toolCalls`; разделение нужно человеку.
 *
 * Незнакомое имя UI покажет как есть: чужие серверы отдают десятки инструментов, и
 * перечислять их все здесь бессмысленно.
 */
export const TOOL_META: Record<string, string> = {
  read_profile: 'прочитал профиль',
  read_recent_logs: 'заглянул в дневник',
  list_recipes: 'посмотрел рецепты',
  save_health_plan: 'сохранил план в data/output.md',
  geocoding: 'нашёл координаты города',
  weather_forecast: 'взял прогноз погоды',
  write_file: 'записал файл',
  // Notion публикует их через дефис, но SDK приводит имена к подчёркиваниям — в toolCalls
  // приезжает именно такая форма.
  API_post_search: 'нашёл страницу в Notion',
  API_post_page: 'создал страницу в Notion',
  suggestWorkoutTemplate: 'взял шаблон тренировки',
  generateShoppingList: 'собрал список покупок',
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

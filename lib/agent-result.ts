/**
 * Форма ответа `POST /api/agent/run` — нестримингового входа — и общее оформление:
 * расшифровки вердиктов и инструментов, разбор пометки источника, формат длительности.
 *
 * Живёт отдельно от компонентов: вердикт читают и таймлайн, и строка итога, и карточка
 * предохранителя, дублировать его описание нельзя. Форма частей стрима описана не здесь,
 * а в `chat-stream.ts`: это разные контракты с разными потребителями.
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

/**
 * Одно обращение к базе знаний. Зеркалит `RetrievalRecord` из `src/skills/knowledge.ts`.
 * Текстов чанков здесь нет — только заголовки: UI показывает, чем агент пользовался,
 * а не пересказывает базу.
 */
export type RetrievalRecord = {
  query: string;
  headings: string[];
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
  /**
   * Обращения к базе знаний по порядку. Списком, а не полем внутри `toolCalls`, потому что
   * там лежат только имена: i-я запись соответствует i-му вызову `searchKnowledge`.
   * Старые ответы и трейсы (до `docs/spec8.md`) поля не имеют — отсюда `?`.
   */
  retrievals?: RetrievalRecord[];
  promptVersions: PromptVersions;
  /**
   * Сколько раз ревьюера переспрашивали из-за невалидного JSON (`docs/specB.md`).
   * На нативном `response_format` ожидается 0. Ответы до specB поля не имеют — отсюда `?`.
   */
  reviewRetries?: number;
  /** Прогон в Langfuse. Пусто — платформа выключена, и разбор идёт по `runs/*.json`. */
  traceId?: string;
  durationMs: number;
  /**
   * Модуль OS, под которым шёл прогон, и уверенность роутера (`docs/specA.md`).
   * `general` — специализации не было. Ответы до OS полей не имеют — отсюда `?`.
   */
  module?: string;
  intentConfidence?: number;
};

/** Имя инструмента поиска по базе знаний: по нему таймлайн отличает `[rag]` от `[local]`. */
export const SEARCH_KNOWLEDGE_TOOL = 'searchKnowledge';

/**
 * Что делает инструмент — человеческой строкой: имя из API само по себе объясняет мало.
 *
 * Откуда инструмент пришёл, писать здесь не нужно: источник виден плашкой и приходит
 * из harness отдельным полем. Для агента разницы всё равно нет — MCP-инструмент и
 * локальный `tool()` вызываются одинаково и лежат в одном `toolCalls`; разделение нужно
 * человеку.
 *
 * Незнакомое имя UI покажет как есть: чужие серверы отдают десятки инструментов, и
 * перечислять их все здесь бессмысленно.
 */
export const TOOL_META: Record<string, string> = {
  read_profile: 'прочитал профиль',
  read_recent_logs: 'заглянул в дневник',
  list_recipes: 'посмотрел рецепты',
  read_habits: 'посмотрел трекер привычек',
  check_habit: 'отметил привычку выполненной',
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
  searchKnowledge: 'поискал в базе знаний',
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

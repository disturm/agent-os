/**
 * Персистентный слепок прогона: `runs/run-<timestamp>.json`.
 *
 * Всё, что harness знает о прогоне, до сих пор жило только в ответе API: закрыл вкладку —
 * и сравнить вчерашний результат с сегодняшним уже нечем. Модуль отвечает ровно за формат
 * этого слепка и за две операции над ним — записать и прочитать. Ни оркестрации, ни решений
 * по вердикту здесь нет.
 *
 * Про оркестратор модуль не знает намеренно: на входе `TraceSource` — структурный тип из тех
 * полей, которые попадают в файл. `AgentResult` ему соответствует, но импорта (и цикла между
 * модулями) не возникает, а поменять форму результата, не тронув трейс, становится нельзя молча.
 *
 * Только локальные JSON: ни Langfuse, ни OpenTelemetry, ни другой внешней телеметрии в проекте нет.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PromptVersions } from './promptVersions';
import type { RoundState } from './rounds';
import type { Review } from './validateReview';

/** Каталог трейсов, от корня проекта. В `.gitignore` целиком, кроме `run-example.json`. */
const RUNS_DIR = 'runs';

/** Сколько символов плана остаётся в трейсе. План целиком раздувает файл и для сравнения не нужен. */
export const EXCERPT_LIMIT = 500;

/** Раунд в трейсе: вердикт целиком, план — только началом. */
export type TraceRound = {
  round: number;
  planExcerpt: string;
  review: Review;
};

/**
 * Одно обращение к базе знаний: с чем пришли и что нашли.
 *
 * Тексты чанков сюда не едут — только заголовки: по паре «запрос → заголовки» видно, чем
 * агент пользовался, а содержимое лежит в `knowledge/*.md` и никуда не девается.
 * Тип объявлен здесь структурно, как и `TraceSource`: модуль трейса не должен зависеть
 * ни от `src/rag/`, ни от `src/skills/`.
 */
export type TraceRetrieval = {
  query: string;
  headings: string[];
};

export type RunTrace = {
  runId: string;
  task: string;
  promptVersions: PromptVersions;
  model: string;
  rounds: TraceRound[];
  toolCalls: string[];
  /** Retrieval по порядку. i-я запись — i-й вызов `searchKnowledge` из `toolCalls`. */
  retrievals: TraceRetrieval[];
  finalScore: number;
  verdict: Review['verdict'];
  durationMs: number;
  createdAt: string;
};

/** То из результата прогона, что уезжает в трейс. `AgentResult` подходит структурно. */
export type TraceSource = {
  rounds: RoundState[];
  review: Review;
  finalScore: number;
  toolCalls: string[];
  retrievals: TraceRetrieval[];
  promptVersions: PromptVersions;
  durationMs: number;
};

/** Начало плана. Обрезали — ставим многоточие, чтобы усечение было видно глазом. */
function excerpt(plan: string): string {
  return plan.length > EXCERPT_LIMIT ? `${plan.slice(0, EXCERPT_LIMIT)}…` : plan;
}

/**
 * Имя прогона из времени создания. Двоеточия и точку ISO заменяем на дефисы:
 * `:` в именах файлов запрещено в Windows, и путь ломается ещё до записи.
 */
function runIdFrom(createdAt: string): string {
  return `run-${createdAt.replace(/[:.]/g, '-')}`;
}

/**
 * Пишет трейс прогона и возвращает путь к нему (или `undefined`, если записать не вышло).
 *
 * Не бросает никогда: трейс — это диагностика, а прогон к этому моменту уже состоялся
 * и оплачен. Ронять готовый результат из-за недоступного каталога было бы обменом
 * ценного на служебное; вместо этого пишем предупреждение в лог.
 */
export function saveTrace(task: string, model: string, source: TraceSource): string | undefined {
  try {
    const createdAt = new Date().toISOString();
    const runId = runIdFrom(createdAt);
    const trace: RunTrace = {
      runId,
      task,
      promptVersions: source.promptVersions,
      model,
      rounds: source.rounds.map(({ round, plan, review }) => ({ round, planExcerpt: excerpt(plan), review })),
      toolCalls: source.toolCalls,
      retrievals: source.retrievals,
      finalScore: source.finalScore,
      verdict: source.review.verdict,
      durationMs: source.durationMs,
      createdAt,
    };

    const dir = join(process.cwd(), RUNS_DIR);
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `${runId}.json`);
    writeFileSync(path, `${JSON.stringify(trace, null, 2)}\n`, 'utf8');

    const shown = `${RUNS_DIR}/${runId}.json`;
    console.log(`Трейс: ${shown}`);
    return shown;
  } catch (err: unknown) {
    console.warn(`! трейс не записан: ${err instanceof Error ? err.message : String(err)}`);
    return undefined;
  }
}

/**
 * Читает трейс по пути. В отличие от записи — бросает: путь сюда приходит от человека
 * из аргументов командной строки, и молча продолжать с пустым объектом нельзя.
 *
 * Проверяется только `task`: это единственное поле, без которого replay бессмысленен.
 * Остальное идёт в сравнение как есть — трейс от прежней версии формата лучше показать
 * с прочерками, чем отвергнуть целиком.
 */
export function readTrace(path: string): RunTrace {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    throw new Error(`Не читается файл трейса: ${path}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Трейс ${path} — не валидный JSON`);
  }

  const trace = parsed as RunTrace;
  if (!trace || typeof trace.task !== 'string' || !trace.task.trim()) {
    throw new Error(`В трейсе ${path} нет поля task — повторить прогон нечем`);
  }
  return trace;
}

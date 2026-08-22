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
 * По `docs/specB.md` запись стала двойной: тот же прогон дополнительно уезжает в Langfuse
 * деревом спанов. Локальный JSON при этом **не отменяется и не урезается** — это и fallback,
 * и учебный артефакт, и единственное, на что опираются `npm run replay` и разбор постфактум.
 * Сборка дерева живёт не здесь, а в `src/langfuse/runTrace.ts`: этот модуль отвечает за формат
 * файла, тот — за формат платформы, и смешивать их незачем.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sendRunToLangfuse } from '../langfuse/runTrace';
import type { Observation } from './observations';
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
  /**
   * Модуль OS, под которым шёл прогон, и уверенность роутера (`docs/specA.md`).
   *
   * В трейсе они рядом с версиями промптов не случайно: это такая же конфигурация прогона.
   * По ним видно, почему у двух похожих задач разошлись наборы инструментов, и заодно —
   * ошибся ли роутер. `general` означает, что уверенности не хватило и специализации не было.
   * В трейсах до `docs/specA.md` полей нет — отсюда `?`.
   */
  module?: string;
  intentConfidence?: number;
  promptVersions: PromptVersions;
  model: string;
  rounds: TraceRound[];
  toolCalls: string[];
  /** Retrieval по порядку. i-я запись — i-й вызов `searchKnowledge` из `toolCalls`. */
  retrievals: TraceRetrieval[];
  finalScore: number;
  verdict: Review['verdict'];
  /**
   * Сколько раз ревьюер вернул невалидный JSON и его пришлось переспрашивать (`docs/specB.md`).
   *
   * Ради этого числа и затевались structured outputs: на нативном json_schema оно обязано
   * быть нулём, и трейс — единственное место, где это видно постфактум. В трейсах до specB
   * поля нет — отсюда `?`.
   */
  reviewRetries?: number;
  /** Тот же прогон в Langfuse. Пусто — платформа была выключена. Связывает файл и дерево спанов. */
  langfuseTraceId?: string;
  durationMs: number;
  createdAt: string;
};

/** То из результата прогона, что уезжает в трейс. `AgentResult` подходит структурно. */
export type TraceSource = {
  plan: string;
  rounds: RoundState[];
  review: Review;
  finalRound: number;
  finalScore: number;
  reviewRetries: number;
  toolCalls: string[];
  retrievals: TraceRetrieval[];
  promptVersions: PromptVersions;
  durationMs: number;
  /** Маршрутизация OS. Нет её — прогон шёл мимо роутера, и полей в трейсе не будет. */
  routing?: { module: string; intentConfidence: number };
  /** Идентификатор трейса в Langfuse. Генерится оркестратором до записи — к нему привяжутся evals. */
  langfuseTraceId?: string;
  /**
   * След прогона по шагам. В файл не пишется намеренно: там нужен слепок для сравнения,
   * а не поминутный лог — им заведует платформа.
   */
  observations?: Observation[];
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
 * Пишет трейс прогона: файл в `runs/` и, если платформа включена, дерево спанов в Langfuse.
 *
 * Не бросает никогда — ни на файле, ни на сети: трейс это диагностика, а прогон к этому
 * моменту уже состоялся и оплачен. Ронять готовый результат из-за недоступного каталога
 * или упавшего Langfuse было бы обменом ценного на служебное; вместо этого — предупреждение.
 *
 * Асинхронная она с `docs/specB.md` и намеренно ожидается вызывающим: отправить «в фоне»
 * из роута Next нельзя — ответ уедет пользователю, обработчик завершится, и запрос
 * оборвётся на полпути. Одна HTTP-отправка на фоне прогона длиной в минуту незаметна.
 */
export async function saveTrace(task: string, model: string, source: TraceSource): Promise<string | undefined> {
  const path = writeLocalTrace(task, model, source);

  await sendRunToLangfuse({
    traceId: source.langfuseTraceId ?? '',
    task,
    plan: source.plan,
    model,
    verdict: source.review.verdict,
    finalRound: source.finalRound,
    finalScore: source.finalScore,
    reviewRetries: source.reviewRetries,
    durationMs: source.durationMs,
    promptVersions: source.promptVersions,
    routing: source.routing,
    observations: source.observations ?? [],
  });

  return path;
}

/** Локальная половина двойной записи. Осталась ровно такой, какой была до specB. */
function writeLocalTrace(task: string, model: string, source: TraceSource): string | undefined {
  try {
    const createdAt = new Date().toISOString();
    const runId = runIdFrom(createdAt);
    const trace: RunTrace = {
      runId,
      task,
      ...(source.routing ? { module: source.routing.module, intentConfidence: source.routing.intentConfidence } : {}),
      promptVersions: source.promptVersions,
      model,
      rounds: source.rounds.map(({ round, plan, review }) => ({ round, planExcerpt: excerpt(plan), review })),
      toolCalls: source.toolCalls,
      retrievals: source.retrievals,
      finalScore: source.finalScore,
      verdict: source.review.verdict,
      reviewRetries: source.reviewRetries,
      ...(source.langfuseTraceId ? { langfuseTraceId: source.langfuseTraceId } : {}),
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

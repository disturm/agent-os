/**
 * Оркестратор прогона: поднимает MCP-серверы, собирает промпты, агентов, историю раундов
 * и метрики.
 *
 * Здесь только последовательность шагов и решения по вердикту. Всё остальное — в соседях:
 * настройка провайдера в `provider.ts`, промпты в `promptVersions.ts`,
 * валидация ответа ревьюера в `validateReview.ts`,
 * состояние раундов в `rounds.ts`, итоговые метрики в `score.ts`, имена вызванных
 * инструментов в `toolCalls.ts`, слепок прогона на диск — в `traceRun.ts`, формат событий
 * хода прогона — в `runEvents.ts`.
 * Данные агент берёт с MCP-серверов (`src/mcp/`), производные артефакты
 * считают локальные навыки из `src/skills/`.
 *
 * Какие серверы подняты и какие инструменты они дают — этот файл не знает: список приходит
 * из `src/mcp/servers.config.ts`. Подключить ещё один сервер можно, не тронув harness
 * (`docs/spec7.md`); harness распоряжается не составом наборов, а моментом их выдачи.
 */

import { randomUUID } from 'node:crypto';
import { run } from '@openai/agents';
import { createCoach, createPlanSaver } from '../agents/healthCoach';
import { createReviewer } from '../agents/safetyReviewer';
import { isLangfuseEnabled } from '../langfuse/client';
import { startConfiguredServers, type McpCallTool, type McpConnections } from '../mcp/mcpClients';
import { assertRagConfigured } from '../rag/retriever';
import type { RetrievalRecord } from '../skills/knowledge';
import { createObservationLog, usageOf, type Observation, type UsageSource } from './observations';
import { resolvePrompt, type PromptVersions } from './promptVersions';
import { MODEL, REVIEWER_MODEL } from './provider';
import { createRoundHistory, type RoundState } from './rounds';
import { IGNORE_EVENTS, type OnEvent } from './runEvents';
import { finalRound, finalScore, improved } from './score';
import { calledTool, LOCAL_SOURCE, toolCallNames } from './toolCalls';
import { saveTrace } from './traceRun';
import { validateReview, type Review } from './validateReview';

// Провайдер настраивается импортом `./provider` — там же живёт и проверка ключа.
// Здесь он только переэкспортируется: `MODEL` уезжает в трейс и в replay.
export { MODEL };

export type AgentResult = {
  plan: string;
  review: Review;
  /** Полная история: план каждого раунда и вердикт на него. */
  rounds: RoundState[];
  /** Номер раунда, ставшего итогом. Может быть меньше `rounds.length` — см. `finalRound`. */
  finalRound: number;
  /** Оценка итогового раунда. */
  finalScore: number;
  /** Выросла ли оценка от первого раунда к последнему. */
  improved: boolean;
  /**
   * Вызовы коуча за прогон, по порядку, с пометкой источника: `[weather] weather_forecast`.
   * Все серверы и локальные навыки — одним списком.
   */
  toolCalls: string[];
  /**
   * Обращения к базе знаний, по порядку: запрос и заголовки найденных секций.
   * i-я запись соответствует i-му вызову `searchKnowledge` в `toolCalls` — по ней видно
   * не только что агент искал, но и что нашёл.
   */
  retrievals: RetrievalRecord[];
  /** Версии промптов, на которых сделан этот прогон. `langfuse:7` — платформа, `v6` — файл. */
  promptVersions: PromptVersions;
  /**
   * Сколько раз ревьюера пришлось переспрашивать из-за невалидного JSON, за весь прогон
   * (`docs/specB.md`). На нативном `response_format` ожидается 0.
   */
  reviewRetries: number;
  /**
   * Идентификатор прогона в Langfuse. `undefined` — платформа выключена.
   * По нему evals привязывают свои оценки к дереву спанов (см. `src/langfuse/scores.ts`).
   */
  traceId?: string;
  durationMs: number;
};

/**
 * Что доступно шагу обновления памяти. Прогон к этому моменту закончен и одобрен,
 * MCP-серверы ещё подняты — это и есть единственное окно, в котором можно дописать дневник
 * и предпочтения, не поднимая процессы во второй раз.
 */
export type ApprovedContext = {
  task: string;
  /** Итоговый план — тот же текст, что уехал пользователю и в `data/output.md`. */
  plan: string;
  /** Прямой вызов MCP-инструмента: `append_daily_log` и `update_preferences` агенту не выдаются. */
  callTool: McpCallTool;
};

export type RunOptions = {
  /** Сколько раундов ревью обязательны, даже если план одобрен раньше. */
  minRounds?: number;
  /** Потолок раундов: после него `revise` возвращается как есть. */
  maxRounds?: number;
  /**
   * Наблюдатель за ходом прогона (`docs/spec9.md`). Необязателен и ни на что не влияет:
   * без него порядок шагов, вызовы модели и результат те же самые — отсюда и требование
   * спеки, что `POST /api/agent/run`, CLI, replay и evals продолжают работать как прежде.
   */
  onEvent?: OnEvent;
  /**
   * Специализация модуля OS (`docs/specA.md`): промпт коуча вместо активной версии.
   * `undefined` — активный промпт из `promptVersions.ts`, то есть поведение до OS.
   *
   * Про модули harness не знает: сюда приходит готовый текст, ровно как из `loadActivePrompt`.
   */
  coachInstructions?: string;
  /**
   * Белый список черновых инструментов по именам. `undefined` — весь доступный набор.
   * Имя, которого в наборе нет, роняет прогон до первого платного вызова (см. `createCoach`).
   *
   * Шага фиксации это не касается: `approvedTools` собирает конфиг, и модуль их не сужает —
   * право на необратимую запись остаётся вопросом состояния прогона, а не специализации.
   */
  draftTools?: readonly string[];
  /**
   * Метка маршрутизации для трейса: какой модуль выбран и насколько уверенно.
   * На сам прогон не влияет — влияют `coachInstructions` и `draftTools`.
   */
  routing?: { module: string; intentConfidence: number };
  /**
   * Шаги, случившиеся **до** прогона и потому harness не наблюдавшиеся, — сейчас это
   * единственный вызов роутера OS (`docs/specB.md`).
   *
   * Нужны, чтобы итог по стоимости был честным: классификация тоже платная, и без неё
   * сумма по дереву занижена. Собирать их harness не может — они произошли раньше, чем он
   * получил управление, — поэтому приходят готовыми, ровно как `coachInstructions`.
   * Порядок сохраняется: они идут первыми, и по ним же считается начало трейса.
   */
  priorObservations?: readonly Observation[];
  /**
   * Шаг после `approve` и сохранения плана (`docs/specA.md`): обновление памяти.
   *
   * Момент принадлежит harness — серверы ещё подняты, план уже зафиксирован, — а что именно
   * записать, решает вызывающий (`src/os/memory.ts`). Без колбэка прогон идёт как прежде.
   * Сбой шага прогон не роняет по той же причине, что и сбой сохранения: план уже готов
   * и оплачен, а память — дело служебное.
   */
  afterApprove?: (context: ApprovedContext) => Promise<void>;
};

/**
 * Минимум 1: одобрение с первого раза завершает прогон.
 * Обязательный круг доработки включается явным `minRounds: 2` — он стоит ещё трёх платных вызовов.
 */
export const DEFAULT_MIN_ROUNDS = 1;
export const DEFAULT_MAX_ROUNDS = 3;

/**
 * Прогон целиком: проверка параметров, жизненный цикл MCP-серверов, цикл ревью.
 *
 * Каждый сервер — отдельный процесс, поэтому запуск и остановка стоят здесь, а не внутри
 * цикла: поднимаются один раз на прогон, до первого платного вызова, и гасятся в `finally` —
 * и на успехе, и на исключении, иначе процессы переживут запрос и повиснут.
 */
export async function runHealthAgent(
  task: string,
  {
    minRounds = DEFAULT_MIN_ROUNDS,
    maxRounds = DEFAULT_MAX_ROUNDS,
    onEvent = IGNORE_EVENTS,
    coachInstructions,
    draftTools,
    routing,
    priorObservations,
    afterApprove,
  }: RunOptions = {},
): Promise<AgentResult> {
  // Проверяем до вызовов модели: параметры кривые — платить за прогон незачем
  if (minRounds < 1) throw new Error('minRounds не может быть меньше 1: без ревью план не отдаётся');
  if (maxRounds < minRounds) throw new Error(`maxRounds (${maxRounds}) не может быть меньше minRounds (${minRounds})`);

  // RAG проверяется здесь же, до первого платного вызова: инструмент поиска, который
  // сломается в середине прогона на отсутствующем ключе, оставит коуча без базы знаний,
  // а тот пойдёт сочинять рецепты — ровно то, ради чего база и заводилась. Проверка
  // локальная, ни в Supabase, ни к провайдеру эмбеддингов не ходит.
  const startedAt = performance.now();
  assertRagConfigured();
  const mcp = await startConfiguredServers();
  try {
    return await reviewLoop({
      task,
      minRounds,
      maxRounds,
      startedAt,
      mcp,
      emit: onEvent,
      coachInstructions,
      draftTools,
      routing,
      priorObservations,
      afterApprove,
    });
  } finally {
    await mcp.close();
  }
}

type LoopContext = {
  task: string;
  minRounds: number;
  maxRounds: number;
  /** Отсчёт для `durationMs`: ведётся снаружи, чтобы в него попал и запуск MCP-серверов. */
  startedAt: number;
  mcp: McpConnections;
  emit: OnEvent;
} & Pick<RunOptions, 'coachInstructions' | 'draftTools' | 'routing' | 'priorObservations' | 'afterApprove'>;

async function reviewLoop({
  task,
  minRounds,
  maxRounds,
  startedAt,
  mcp,
  emit,
  coachInstructions,
  draftTools,
  routing,
  priorObservations,
  afterApprove,
}: LoopContext): Promise<AgentResult> {
  const history = createRoundHistory();
  const toolCalls: string[] = [];
  /**
   * Записи о поиске по базе знаний. Копятся здесь, а не внутри инструмента: накопление —
   * дело оркестратора, ровно как с `toolCalls`. Инструмент только зовёт колбэк.
   */
  const retrievals: RetrievalRecord[] = [];
  /**
   * След прогона по шагам — для дерева спанов в Langfuse (`docs/specB.md`).
   *
   * Отдельный канал, третий после `toolCalls` (итоговый список) и `onEvent` (живой таймлайн).
   * Слить их «ради единообразия» нельзя: у списка нет времени, у событий нет прошлого,
   * а дереву нужны обе половины. Без Langfuse накопитель просто наполняется и не читается —
   * порядок шагов и вызовы модели от него не зависят.
   */
  const observations = createObservationLog();
  let reviewRetries = 0;

  // Промпты берутся из Langfuse, если он включён, иначе из `prompts/*.md` (`docs/specB.md`).
  // Версии уезжают в результат и трейс ровно как раньше — поменялся только их источник.
  const [coachSource, reviewerSource] = await Promise.all([resolvePrompt('coach'), resolvePrompt('reviewer')]);
  const promptVersions: PromptVersions = { coach: coachSource.version, reviewer: reviewerSource.version };

  // Агенты собираются на прогон: промпт приходит из файла активной версии,
  // читающие инструменты — со всех поднятых MCP-серверов одним списком.
  // Что необратимо (запись плана, файл, страница в Notion), в этот набор не входит.
  // Промпт модуля OS, если он есть, — вместо активного: специализация это тот же коуч
  // с другой инструкцией и суженным набором, а не второй агент (`docs/specA.md`).
  // Шаг фиксации остаётся на базовом промпте: сохранение одинаково во всех модулях, а текст
  // модуля перечисляет черновые инструменты, которых на этом шаге у агента уже нет.
  const basePrompt = coachSource.text;
  const coachPrompt = coachInstructions ?? basePrompt;
  /**
   * Раунд, к которому относятся текущие шаги: инструменты и поиск вызываются вложенно,
   * изнутри круга, и узнать номер иначе неоткуда. `undefined` — шаг вне раундов (фиксация плана).
   */
  let currentRound: number | undefined = 1;
  const coach = createCoach(
    coachPrompt,
    mcp.draftTools,
    (record) => {
      retrievals.push(record);
      emit({ type: 'retrieval', ...record });
      // Момент вызова колбэка — уже после поиска, поэтому длительности у этой записи нет:
      // её меряет наблюдение самого инструмента, а здесь важно, что искали и что нашли.
      observations.open('retrieval', 'retrieval', currentRound)({ input: record.query, output: record.headings });
      console.log(`  knowledge: «${record.query}» → ${record.headings.length} chunk(s)`);
      for (const heading of record.headings) console.log(`    · ${heading}`);
    },
    draftTools,
  );
  const reviewer = createReviewer(reviewerSource.text);

  /**
   * Живой поток вызовов инструментов для наблюдателя.
   *
   * `toolCallNames` разбирает `result.newItems` уже завершившегося круга — для итогового
   * списка и трейса этого достаточно, а для таймлайна поздно: все вызовы приехали бы разом
   * вместе с готовым планом. Хуки агента отдают их в момент вызова. Списка в `AgentResult`
   * это не касается: он по-прежнему собирается из `newItems`, и два канала не пересекаются.
   *
   * Источник берётся из той же `mcp.sources`, что и у `toolCallNames`, иначе пометки
   * в живом таймлайне и в трейсе разошлись бы.
   */
  /**
   * Незакрытые наблюдения за инструментами, очередями по имени.
   *
   * Очередь, а не «последний вызов», по той же причине, что `pendingSearches` в таймлайне
   * чата: модель зовёт `searchKnowledge` параллельно — два `tool_start` подряд и только потом
   * два `tool_end`. На одной переменной первый вызов остался бы незакрытым навсегда.
   * i-е завершение достаётся i-му вызову.
   */
  const openTools = new Map<string, ((end?: { output?: unknown }) => void)[]>();

  const watchTools = (agent: ReturnType<typeof createCoach>) => {
    agent.on('agent_tool_start', (_context, tool) => {
      const source = mcp.sources.get(tool.name) ?? LOCAL_SOURCE;
      emit({ type: 'tool_call', name: tool.name, source });
      const queue = openTools.get(tool.name) ?? [];
      queue.push(observations.open(tool.name, 'tool', currentRound));
      openTools.set(tool.name, queue);
    });
    agent.on('agent_tool_end', (_context, tool, result) => {
      emit({ type: 'tool_result', name: tool.name });
      openTools.get(tool.name)?.shift()?.({ output: result });
    });
  };
  watchTools(coach);

  /** Прогон коуча: заодно пополняет список вызванных инструментов, чтобы это не забывалось на местах. */
  const askCoach = async (input: string, round: number): Promise<string> => {
    emit({ type: 'coach_start', round });
    currentRound = round;
    const close = observations.open('coach', 'generation', round);
    const result = await run(coach, input);
    const plan = result.finalOutput ?? '';
    close({ input, output: plan, model: MODEL, usage: usageOf(result) });
    const tools = toolCallNames(result.newItems, mcp.sources);
    toolCalls.push(...tools);
    if (tools.length) console.log(`  tools: ${tools.join(', ')}`);
    emit({ type: 'coach_end', round });
    return plan;
  };

  /**
   * Фиксация одобренного плана. Записывает его сам агент — вызовом `save_health_plan`,
   * а если пользователь просил сохранить план ещё куда-то, то и `write_file` (файл
   * в `plans/`) или инструментами Notion.
   *
   * Разрешение даёт harness, а не промпт: необратимые инструменты подключаются только здесь,
   * после `approve` (см. `createPlanSaver`). Строка в промпте «сохраняй только одобренный план»
   * была бы просьбой — модель вольна её не выполнить и зафиксировать черновик, который ревьюер
   * зарубил. Право на необратимую запись — свойство состояния прогона, поэтому им распоряжается
   * код. Появление чужих серверов этого не изменило, наоборот: `filesystem` и `notion` пишут
   * наружу, и попадают они ровно в тот же набор, что и `save_health_plan`, — после проверки.
   *
   * Исходная задача уходит сюда вместе с планом: без неё агент не знает, просили ли его
   * второе место хранения. Дата — потому что имя файла в задаче обычно её содержит
   * (`plans/<дата>.md`), а сам по себе календарь модели неизвестен.
   *
   * Сбой шага прогон не роняет: план уже готов и одобрен, отдавать пользователю ошибку
   * из-за неудачной записи файла было бы хуже, чем вернуть план и предупредить в логе.
   */
  const saveApprovedPlan = async ({ round, plan, review }: RoundState) => {
    const input = [
      `Сегодняшняя дата: ${new Date().toISOString().slice(0, 10)}.`,
      `Ревьюер одобрил план (раунд ${round}, score ${review.score}/10).`,
      '',
      `=== ИСХОДНАЯ ЗАДАЧА ===\n${task}`,
      '',
      'Сохрани план через save_health_plan: передай текст ниже без изменений.',
      'Если в задаче просили сохранить его ещё куда-то — отдельным файлом или страницей в Notion, —',
      'сделай и это, тем же текстом и теми инструментами, которые тебе доступны.',
      '',
      `=== ПЛАН ===\n${plan}`,
    ].join('\n');
    emit({ type: 'saving' });
    // Шаг фиксации идёт вне раундов: он один на прогон и относится к итогу, а не к кругу.
    currentRound = undefined;
    const close = observations.open('save-plan', 'generation');
    try {
      const saver = createPlanSaver(basePrompt, mcp.approvedTools);
      watchTools(saver);
      const result = await run(saver, input);
      close({ input, output: result.finalOutput ?? '', model: MODEL, usage: usageOf(result) });
      const tools = toolCallNames(result.newItems, mcp.sources);
      toolCalls.push(...tools);
      if (calledTool(tools, 'save_health_plan')) console.log(`\nПлан сохранён в data/output.md. Score: ${review.score}/10`);
      else console.warn('\n! агент не вызвал save_health_plan — data/output.md не обновлён');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      // Закрываем наблюдение и здесь: шаг, оборвавшийся на исключении, обязан попасть
      // в дерево — именно такой и интересно потом рассматривать.
      close({ output: `ошибка: ${message}` });
      console.warn(`\n! сохранить план не вышло: ${message}`);
    }
  };

  /**
   * Единая точка выхода. План и вердикт берутся не из последнего раунда, а из итогового
   * (`finalRound`): доработка сверх `minRounds` не должна перечёркивать уже одобренный план.
   * Зовётся только после записи хотя бы одного раунда, поэтому история заведомо не пуста.
   *
   * Здесь же единственное обращение к `data/output.md` за прогон: сохраняется ровно тот план,
   * который уехал пользователю, и только если итоговый вердикт — `approve`.
   *
   * И здесь же пишется трейс — по той же причине, по которой выход один: прогон, ушедший
   * мимо `runs/`, потом не с чем сравнить. Запись трейса прогон не роняет (см. `saveTrace`).
   */
  /**
   * Обновление памяти после одобрения (`docs/specA.md`).
   *
   * Стоит здесь, а не в `src/os/`, только моментом: серверы ещё подняты, план уже
   * зафиксирован, и это единственное окно, в котором дневник и предпочтения дописываются
   * без второго запуска процессов. Что именно записать, harness не решает — это колбэк.
   *
   * Сбой не роняет прогон по той же причине, что и сбой сохранения: план готов и оплачен,
   * а не дописанная строка в дневнике — потеря служебная.
   */
  const updateMemory = async (plan: string) => {
    if (!afterApprove) return;
    try {
      await afterApprove({ task, plan, callTool: mcp.callTool });
    } catch (err: unknown) {
      console.warn(`\n! память не обновлена: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const finish = async (): Promise<AgentResult> => {
    const rounds = history.all();
    const outcome = finalRound(rounds)!;
    if (outcome.review.verdict === 'approve') {
      await saveApprovedPlan(outcome);
      await updateMemory(outcome.plan);
    }

    const result: AgentResult = {
      plan: outcome.plan,
      review: outcome.review,
      rounds,
      finalRound: outcome.round,
      finalScore: finalScore(rounds),
      improved: improved(rounds),
      toolCalls,
      retrievals,
      promptVersions,
      reviewRetries,
      // Идентификатор заводится только когда есть куда его отправить: пустое поле в результате
      // честнее выдуманного id, по которому в платформе ничего не найдётся.
      ...(isLangfuseEnabled() ? { traceId: randomUUID() } : {}),
      durationMs: Math.round(performance.now() - startedAt),
    };
    console.log(
      `Итог: раунд ${outcome.round} из ${rounds.length}, verdict=${outcome.review.verdict}, score=${result.finalScore}/10, инструментов вызвано ${toolCalls.length} (из них поиск по базе знаний ${retrievals.length}), промпты coach ${promptVersions.coach} / reviewer ${promptVersions.reviewer} (источник: ${coachSource.source}), JSON-ретраев ревьюера ${reviewRetries}, ${result.durationMs} мс`,
    );
    await saveTrace(task, MODEL, {
      ...result,
      routing,
      langfuseTraceId: result.traceId,
      // Шаги до прогона идут первыми: по первому наблюдению считается начало трейса,
      // а началом был вызов роутера, а не первое обращение коуча.
      observations: [...(priorObservations ?? []), ...observations.all()],
    });
    return result;
  };

  // Контекст коуча — только задача: профиль, дневник, рецепты и прогноз он берёт инструментами сам
  console.log(`Задача: ${task}\nМодель: ${MODEL}\nMCP: ${mcp.started.join(', ')}\n`);
  let plan = await askCoach(`=== ЗАДАЧА ===\n${task}`, 1);

  for (let round = 1; round <= maxRounds; round++) {
    // Ревьюер видит только задачу и план: инструментов у него нет, к файлам он не ходит,
    // и проверять он обязан текст, который уедет пользователю, а не состояние диска.
    const prompt = `=== ЗАДАЧА ===\n${task}\n\n=== ПЛАН НА ПРОВЕРКУ ===\n${plan}`;
    emit({ type: 'review_start', round });
    currentRound = round;
    const closeReview = observations.open('reviewer', 'generation', round);
    // Расход копится по попыткам: ретрай ревьюера — это ещё один оплаченный вызов,
    // и прятать его из наблюдения нельзя, иначе стоимость прогона окажется занижена.
    const attempts: UsageSource[] = [];
    const { review, retries } = await validateReview(async (retryHint) => {
      const result = await run(reviewer, prompt + retryHint);
      attempts.push(result);
      return result.finalOutput ?? '';
    });
    reviewRetries += retries;
    closeReview({
      input: prompt,
      output: review,
      model: REVIEWER_MODEL,
      usage: usageOf(...attempts),
      metadata: { retries },
    });
    history.record(plan, review);
    emit({ type: 'review_done', round, review });

    const { verdict, score, issues } = review;
    console.log(`Раунд ${round}: verdict=${verdict}, score=${score}`);
    for (const issue of issues) console.log(`  - ${issue}`);

    // Медицинский запрос — дальше не идём. minRounds здесь не действует:
    // гонять такую задачу по кругу бессмысленно, и прежнее одобрение уже не в счёт.
    if (verdict === 'needs_human_professional') {
      console.log('\nЗапрос требует человека-специалиста (врача). Агент не даёт медицинских рекомендаций — план не сохранён.');
      return await finish();
    }

    if (verdict === 'approve') {
      // Одобрение до minRounds цикл не завершает: коуч обязан получить обратную связь.
      // На дефолтном minRounds = 1 условие выполняется сразу; ветка ниже — для явного minRounds >= 2.
      // Результат при этом не пострадает — finalRound откатится на этот раунд.
      if (round >= minRounds) return await finish();
      console.log(`  → обязательных раундов ${minRounds}, отправляю план коучу на доработку\n`);
    } else {
      // verdict === 'revise': отдаём issues обратно коучу
      if (round === maxRounds) break;
      console.log('  → отправляю замечания коучу\n');
    }

    // Одобренному плану замечаний нет — коучу нужна другая формулировка, иначе он правит пустоту
    const feedback = issues.length
      ? `${issues.map((i) => `- ${i}`).join('\n')}\n\nПерепиши план целиком с учётом замечаний.`
      : 'Замечаний у ревьюера нет.\n\nПерепиши план целиком, усилив слабые места: конкретика по времени, порциям и объёмам.';
    // Каждый прогон коуча начинается с чистого листа: данных из прошлого раунда у него нет,
    // поэтому нужные ему файлы он перечитывает инструментами заново.
    const fix = `=== ЗАДАЧА ===\n${task}\n\n=== ПРЕДЫДУЩИЙ ПЛАН ===\n${plan}\n\n=== ЗАМЕЧАНИЯ РЕВЬЮЕРА ===\n${feedback}`;
    plan = (await askCoach(fix, round + 1)) || plan;
  }

  // Одобрение могло случиться раньше, а последний раунд его не подтвердить —
  // тогда итогом станет одобренный раунд, и в output.md уедет именно он
  const approved = finalRound(history.all())!;
  console.log(
    approved.review.verdict === 'approve'
      ? `\nПоследний раунд одобрения не дал — возвращаю одобренный план из раунда ${approved.round}.`
      : `\nПлан не одобрен за ${maxRounds} раунда(ов) — в data/output.md ничего не записано.`,
  );
  return await finish();
}

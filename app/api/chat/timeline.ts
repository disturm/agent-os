/**
 * Перевод событий прогона в части стрима: единственное место, где встречаются
 * `RunEvent` (сервер) и `data-*` (общие с чатом).
 *
 * Живёт рядом с роутом, а не в `lib/`, именно поэтому: `lib/` не импортирует `src/`.
 * И не в harness — harness про AI SDK не знает и знать не должен.
 *
 * Что здесь решается: **порядок этапов задаём мы, а не случайность момента**. Спека
 * перечисляет шаги списком, а события приходят в порядке работы модели, поэтому все шаги
 * круга объявляются сразу, `pending`, и дальше только меняют статус по своему `id`.
 * Иначе «Searching knowledge» приезжал бы то до «Generating plan», то после, в зависимости
 * от того, когда коуч решил сходить в базу знаний.
 *
 * Чего здесь нет: решений о прогоне. Модуль только пересказывает то, что уже произошло.
 */

import type { UIMessageStreamWriter } from 'ai';
import type { RunEvent } from '../../../src/harness/runEvents';
import { SEARCH_KNOWLEDGE_TOOL } from '../../../lib/agent-result';
import type { AgentResult } from '../../../src/harness/runHealthAgent';
import type { ChatMessage, StepData, ToolData } from '../../../lib/chat-stream';

type Writer = UIMessageStreamWriter<ChatMessage>;

/** Шаг выбора модуля. Один на прогон и всегда первый: маршрутизация идёт до цикла. */
const MODULE = 'module';
/** Ключи шагов круга. `id` части — `<ключ>-<номер раунда>`, чтобы раунды не перезаписывали друг друга. */
const READING = 'reading';
const KNOWLEDGE = 'knowledge';
const GENERATING = 'generating';
const REVIEW = 'review';
/** Шаг итога один на прогон, без номера раунда. */
const FINAL = 'final';

/** Названия из `docs/spec9.md` — по ним же сверяется Definition of Done. */
const FINAL_LABEL: Record<string, string> = {
  approve: 'Final approved plan',
  revise: 'Plan not approved',
  needs_human_professional: 'Stopped: needs a human professional',
};

export type Timeline = {
  /** Приёмник для `runHealthAgent({ onEvent })`. */
  handle: OnEventHandler;
  /** Закрывает последний шаг таймлайна. Зовётся до печати плана. */
  closeSteps(result: AgentResult): void;
  /** Строка с вердиктом и счётом. Зовётся после плана: части рисуются в порядке записи. */
  summarize(result: AgentResult): void;
};

type OnEventHandler = (event: RunEvent) => void;

export function createTimeline(writer: Writer): Timeline {
  const steps = new Map<string, StepData>();
  const tools = new Map<string, ToolData>();
  let round = 0;
  /** Шаг, под которым сейчас копятся вызовы инструментов. */
  let currentStep = '';
  /**
   * Вызовы `searchKnowledge`, ещё не получившие своей записи о retrieval.
   *
   * Очередь, а не «последний вызов»: модель зовёт поиск параллельно (в живом прогоне пришли
   * два вызова подряд и только потом два ответа), и на одной переменной первый вызов остался
   * бы без запроса, а второй получил бы оба по очереди. i-я запись достаётся i-му вызову —
   * тем же правилом, каким `retrievals` сопоставляются с `toolCalls` в трейсе.
   */
  const pendingSearches: string[] = [];
  let toolSeq = 0;
  /**
   * Начался шаг фиксации. После него шаги круга не оживают: `save_health_plan` возвращает
   * результат, и без этого флага «Generating plan» первого раунда вспыхивал бы уже под итогом.
   */
  let sealed = false;

  const key = (name: string) => `${name}-${round}`;

  const putStep = (id: string, data: StepData) => {
    // Пустая правка — тоже запись в стрим: без этой проверки на каждый вызов инструмента
    // уезжала бы копия неизменившегося шага.
    if (JSON.stringify(steps.get(id)) === JSON.stringify(data)) return;
    steps.set(id, data);
    writer.write({ type: 'data-step', id, data });
  };

  const patchStep = (id: string, patch: Partial<StepData>) => {
    const current = steps.get(id);
    if (current) putStep(id, { ...current, ...patch });
  };

  /** Перевести шаг из работы в готовность, не трогая пропущенные и ещё не начатые. */
  const closeStep = (id: string) => {
    if (steps.get(id)?.status === 'running') patchStep(id, { status: 'done' });
  };

  const putTool = (id: string, data: ToolData) => {
    tools.set(id, data);
    writer.write({ type: 'data-tool', id, data });
  };

  const handle: OnEventHandler = (event) => {
    switch (event.type) {
      case 'module': {
        // Сразу `done`: выбор модуля уже состоялся к моменту события, ждать в таймлайне нечего.
        // Шаг приезжает первым и остаётся сверху — маршрутизация идёт до первого круга коуча.
        putStep(MODULE, {
          label: `🧭 Module: ${event.module}`,
          status: 'done',
          detail: `confidence ${event.confidence.toFixed(2)}`,
        });
        return;
      }

      case 'coach_start': {
        round = event.round;
        // Первый круг — черновик, дальше доработка по замечаниям: у спеки это разные шаги.
        putStep(key(READING), {
          label: round === 1 ? 'Reading profile' : `Revising (round ${round})`,
          status: 'running',
        });
        putStep(key(KNOWLEDGE), { label: 'Searching knowledge', status: 'pending' });
        putStep(key(GENERATING), { label: 'Generating plan', status: 'pending' });
        currentStep = key(READING);
        return;
      }

      case 'tool_call': {
        // Поиск по базе знаний — отдельный этап спеки, остальные вызовы идут строками
        // под тем шагом, который сейчас открыт.
        const search = event.name === SEARCH_KNOWLEDGE_TOOL;
        if (search && !sealed) {
          closeStep(key(READING));
          patchStep(key(KNOWLEDGE), { status: 'running' });
          currentStep = key(KNOWLEDGE);
        }
        const id = `tool-${++toolSeq}`;
        putTool(id, { name: event.name, source: event.source, step: currentStep });
        if (search) pendingSearches.push(id);
        return;
      }

      case 'retrieval': {
        const previous = steps.get(key(KNOWLEDGE))?.detail;
        patchStep(key(KNOWLEDGE), {
          detail: previous ? `${previous}; «${event.query}»` : `«${event.query}»`,
        });
        const id = pendingSearches.shift();
        const tool = id ? tools.get(id) : undefined;
        if (id && tool) putTool(id, { ...tool, query: event.query, headings: event.headings });
        return;
      }

      case 'tool_result': {
        if (sealed) return;
        // Инструмент вернул результат — слово снова у модели, и это ровно «Generating plan».
        // Следующий вызов инструмента снова откроет свой шаг: колебание туда-обратно
        // и есть настоящий ход круга, а не приукрашивание.
        closeStep(key(READING));
        closeStep(key(KNOWLEDGE));
        patchStep(key(GENERATING), { status: 'running' });
        currentStep = key(GENERATING);
        return;
      }

      case 'coach_end': {
        for (const name of [READING, KNOWLEDGE, GENERATING]) {
          const step = steps.get(key(name));
          if (step?.status === 'running') patchStep(key(name), { status: 'done' });
          // Коуч не искал в базе знаний — так и напишем, вместо того чтобы прятать шаг.
          if (step?.status === 'pending') patchStep(key(name), { status: 'skipped' });
        }
        return;
      }

      case 'review_start': {
        round = event.round;
        putStep(key(REVIEW), { label: 'Reviewing safety', status: 'running' });
        currentStep = key(REVIEW);
        return;
      }

      case 'review_done': {
        patchStep(key(REVIEW), {
          status: 'done',
          detail: `${event.review.verdict} · ${event.review.score}/10`,
          issues: event.review.issues,
        });
        return;
      }

      case 'saving': {
        // Шаг фиксации и есть шестой шаг спеки: сюда попадают save_health_plan, write_file
        // и вызовы Notion — те самые необратимые инструменты, что выдаются после approve.
        sealed = true;
        putStep(FINAL, { label: FINAL_LABEL.approve, status: 'running' });
        currentStep = FINAL;
        return;
      }
    }
  };

  const closeSteps = (result: AgentResult) => {
    const { verdict } = result.review;
    // Шага фиксации не было — значит, план не одобрен: итог всё равно нужен строкой.
    if (!steps.has(FINAL)) putStep(FINAL, { label: FINAL_LABEL[verdict], status: 'done' });
    else patchStep(FINAL, { status: 'done' });
  };

  const summarize = (result: AgentResult) => {
    writer.write({
      type: 'data-summary',
      id: 'summary',
      data: {
        verdict: result.review.verdict,
        score: result.finalScore,
        finalRound: result.finalRound,
        totalRounds: result.rounds.length,
        durationMs: result.durationMs,
        promptVersions: result.promptVersions,
      },
    });
  };

  return { handle, closeSteps, summarize };
}

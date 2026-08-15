/**
 * Оркестратор прогона: собирает провайдер, промпты, агентов, историю раундов и метрики.
 *
 * Здесь только последовательность шагов и решения по вердикту. Всё остальное — в соседях:
 * промпты в `promptVersions.ts`, валидация ответа ревьюера в `validateReview.ts`,
 * состояние раундов в `rounds.ts`, итоговые метрики в `score.ts`, имена вызванных
 * инструментов в `toolCalls.ts`, слепок прогона на диск — в `traceRun.ts`.
 * Сами инструменты — в `src/skills/`.
 */

import OpenAI from 'openai';
import { run, setDefaultOpenAIClient, setOpenAIAPI, setTracingDisabled } from '@openai/agents';
import { createCoach, createPlanSaver } from '../agents/healthCoach';
import { createReviewer } from '../agents/safetyReviewer';
import { ACTIVE_PROMPTS, loadActivePrompt, type PromptVersions } from './promptVersions';
import { createRoundHistory, type RoundState } from './rounds';
import { finalRound, finalScore, improved } from './score';
import { toolCallNames } from './toolCalls';
import { saveTrace } from './traceRun';
import { validateReview, type Review } from './validateReview';

// --- Провайдер: DeepSeek через OpenAI-совместимый API ---
const apiKey = process.env.DEEPSEEK_API_KEY;
if (!apiKey) throw new Error('Нет DEEPSEEK_API_KEY в .env (см. .env.example)');
setDefaultOpenAIClient(new OpenAI({ baseURL: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com', apiKey }));
setOpenAIAPI('chat_completions'); // DeepSeek говорит на /chat/completions, не на Responses API
setTracingDisabled(true);
export const MODEL = process.env.DEEPSEEK_MODEL ?? 'deepseek-v4-pro';

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
  /** Имена инструментов, вызванных коучем за прогон, по порядку. Ревьюер сюда попасть не может. */
  toolCalls: string[];
  /** Версии промптов, на которых сделан этот прогон. */
  promptVersions: PromptVersions;
  durationMs: number;
};

export type RunOptions = {
  /** Сколько раундов ревью обязательны, даже если план одобрен раньше. */
  minRounds?: number;
  /** Потолок раундов: после него `revise` возвращается как есть. */
  maxRounds?: number;
};

/** Минимум 2: коуч обязан хотя бы раз получить обратную связь ревьюера. */
export const DEFAULT_MIN_ROUNDS = 2;
export const DEFAULT_MAX_ROUNDS = 3;

export async function runHealthAgent(
  task: string,
  { minRounds = DEFAULT_MIN_ROUNDS, maxRounds = DEFAULT_MAX_ROUNDS }: RunOptions = {},
): Promise<AgentResult> {
  // Проверяем до вызовов модели: параметры кривые — платить за прогон незачем
  if (minRounds < 1) throw new Error('minRounds не может быть меньше 1: без ревью план не отдаётся');
  if (maxRounds < minRounds) throw new Error(`maxRounds (${maxRounds}) не может быть меньше minRounds (${minRounds})`);

  const startedAt = performance.now();
  const history = createRoundHistory();
  const toolCalls: string[] = [];
  const promptVersions: PromptVersions = { ...ACTIVE_PROMPTS };

  // Агенты собираются на прогон: промпт приходит из файла активной версии
  const coachPrompt = loadActivePrompt('coach');
  const coach = createCoach(coachPrompt);
  const reviewer = createReviewer(loadActivePrompt('reviewer'));

  /** Прогон коуча: заодно пополняет список вызванных инструментов, чтобы это не забывалось на местах. */
  const askCoach = async (input: string): Promise<string> => {
    const result = await run(coach, input);
    const tools = toolCallNames(result.newItems);
    toolCalls.push(...tools);
    if (tools.length) console.log(`  tools: ${tools.join(', ')}`);
    return result.finalOutput ?? '';
  };

  /**
   * Фиксация одобренного плана: записывает его в `data/output.md` сам агент, вызовом `savePlan`.
   *
   * Разрешение даёт harness, а не промпт: инструмент подключается только здесь, после `approve`
   * (см. `createPlanSaver`). Строка в промпте «сохраняй только одобренный план» была бы просьбой —
   * модель вольна её не выполнить и зафиксировать черновик, который ревьюер зарубил.
   * Право на необратимую запись — свойство состояния прогона, поэтому им распоряжается код.
   *
   * Сбой шага прогон не роняет: план уже готов и одобрен, отдавать пользователю ошибку
   * из-за неудачной записи файла было бы хуже, чем вернуть план и предупредить в логе.
   */
  const saveApprovedPlan = async ({ round, plan, review }: RoundState) => {
    const input = `Ревьюер одобрил план (раунд ${round}, score ${review.score}/10).\nСохрани его через savePlan: передай текст ниже без изменений.\n\n${plan}`;
    try {
      const result = await run(createPlanSaver(coachPrompt), input);
      const tools = toolCallNames(result.newItems);
      toolCalls.push(...tools);
      if (tools.includes('savePlan')) console.log(`\nПлан сохранён в data/output.md. Score: ${review.score}/10`);
      else console.warn('\n! агент не вызвал savePlan — data/output.md не обновлён');
    } catch (err: unknown) {
      console.warn(`\n! сохранить план не вышло: ${err instanceof Error ? err.message : String(err)}`);
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
  const finish = async (): Promise<AgentResult> => {
    const rounds = history.all();
    const outcome = finalRound(rounds)!;
    if (outcome.review.verdict === 'approve') await saveApprovedPlan(outcome);

    const result: AgentResult = {
      plan: outcome.plan,
      review: outcome.review,
      rounds,
      finalRound: outcome.round,
      finalScore: finalScore(rounds),
      improved: improved(rounds),
      toolCalls,
      promptVersions,
      durationMs: Math.round(performance.now() - startedAt),
    };
    console.log(
      `Итог: раунд ${outcome.round} из ${rounds.length}, verdict=${outcome.review.verdict}, score=${result.finalScore}/10, инструментов вызвано ${toolCalls.length}, промпты coach ${promptVersions.coach} / reviewer ${promptVersions.reviewer}, ${result.durationMs} мс`,
    );
    saveTrace(task, MODEL, result);
    return result;
  };

  // Контекст коуча — только задача: профиль, дневник и рецепты он берёт инструментами сам
  console.log(`Задача: ${task}\nМодель: ${MODEL}\n`);
  let plan = await askCoach(`=== ЗАДАЧА ===\n${task}`);

  for (let round = 1; round <= maxRounds; round++) {
    // Ревьюер видит только задачу и план: инструментов у него нет, к файлам он не ходит,
    // и проверять он обязан текст, который уедет пользователю, а не состояние диска.
    const prompt = `=== ЗАДАЧА ===\n${task}\n\n=== ПЛАН НА ПРОВЕРКУ ===\n${plan}`;
    const review = await validateReview(async (retryHint) => (await run(reviewer, prompt + retryHint)).finalOutput ?? '');
    history.record(plan, review);

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
    plan = (await askCoach(fix)) || plan;
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

/**
 * Оркестратор прогона: собирает провайдер, промпты, агентов, историю раундов и метрики.
 *
 * Здесь только последовательность шагов и решения по вердикту. Всё остальное — в соседях:
 * промпты в `promptVersions.ts`, валидация ответа ревьюера в `validateReview.ts`,
 * состояние раундов в `rounds.ts`, итоговые метрики в `score.ts`.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import OpenAI from 'openai';
import { run, setDefaultOpenAIClient, setOpenAIAPI, setTracingDisabled } from '@openai/agents';
import { createCoach } from '../agents/healthCoach';
import { createReviewer } from '../agents/safetyReviewer';
import { ACTIVE_PROMPTS, loadActivePrompt, type PromptVersions } from './promptVersions';
import { createRoundHistory, type RoundState } from './rounds';
import { finalRound, finalScore, improved } from './score';
import { validateReview, type Review } from './validateReview';

// --- Провайдер: DeepSeek через OpenAI-совместимый API ---
const apiKey = process.env.DEEPSEEK_API_KEY;
if (!apiKey) throw new Error('Нет DEEPSEEK_API_KEY в .env (см. .env.example)');
setDefaultOpenAIClient(new OpenAI({ baseURL: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com', apiKey }));
setOpenAIAPI('chat_completions'); // DeepSeek говорит на /chat/completions, не на Responses API
setTracingDisabled(true);
export const MODEL = process.env.DEEPSEEK_MODEL ?? 'deepseek-v4-pro';

const dataFile = (name: string) => join(process.cwd(), 'data', name);

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
  const promptVersions: PromptVersions = { ...ACTIVE_PROMPTS };

  // Агенты собираются на прогон: промпт приходит из файла активной версии
  const coach = createCoach(loadActivePrompt('coach'));
  const reviewer = createReviewer(loadActivePrompt('reviewer'));

  /**
   * Единая точка выхода. План и вердикт берутся не из последнего раунда, а из итогового
   * (`finalRound`): доработка сверх `minRounds` не должна перечёркивать уже одобренный план.
   * Зовётся только после записи хотя бы одного раунда, поэтому история заведомо не пуста.
   */
  const finish = (): AgentResult => {
    const rounds = history.all();
    const outcome = finalRound(rounds)!;
    const result: AgentResult = {
      plan: outcome.plan,
      review: outcome.review,
      rounds,
      finalRound: outcome.round,
      finalScore: finalScore(rounds),
      improved: improved(rounds),
      promptVersions,
      durationMs: Math.round(performance.now() - startedAt),
    };
    console.log(
      `Итог: раунд ${outcome.round} из ${rounds.length}, verdict=${outcome.review.verdict}, score=${result.finalScore}/10, промпты coach ${promptVersions.coach} / reviewer ${promptVersions.reviewer}, ${result.durationMs} мс`,
    );
    return result;
  };

  // Контекст = профиль + дневник + задача
  const profile = readFileSync(dataFile('profile.md'), 'utf8');
  const log = readFileSync(dataFile('log.md'), 'utf8');
  const context = `=== ПРОФИЛЬ ПОЛЬЗОВАТЕЛЯ ===\n${profile}\n\n=== ДНЕВНИК ПОСЛЕДНИХ ДНЕЙ ===\n${log}\n\n=== ЗАДАЧА ===\n${task}`;

  console.log(`Задача: ${task}\nМодель: ${MODEL}\n`);
  let plan = (await run(coach, context)).finalOutput ?? '';

  for (let round = 1; round <= maxRounds; round++) {
    const prompt = `${context}\n\n=== ПЛАН НА ПРОВЕРКУ ===\n${plan}`;
    const review = await validateReview(async (retryHint) => (await run(reviewer, prompt + retryHint)).finalOutput ?? '');
    history.record(plan, review);

    const { verdict, score, issues } = review;
    console.log(`Раунд ${round}: verdict=${verdict}, score=${score}`);
    for (const issue of issues) console.log(`  - ${issue}`);

    // Медицинский запрос — дальше не идём. minRounds здесь не действует:
    // гонять такую задачу по кругу бессмысленно, и прежнее одобрение уже не в счёт.
    if (verdict === 'needs_human_professional') {
      console.log('\nЗапрос требует человека-специалиста (врача). Агент не даёт медицинских рекомендаций — план не сохранён.');
      return finish();
    }

    if (verdict === 'approve') {
      writeFileSync(dataFile('output.md'), `# ${task}\n\n${plan}\n\n---\nSafety score: ${score}/10, раундов: ${round}\n`, 'utf8');
      console.log(`\nПлан сохранён в data/output.md. Score: ${score}/10`);
      // Одобрение до minRounds цикл не завершает: коуч обязан получить обратную связь.
      // Результат при этом не пострадает — finalRound откатится на этот раунд.
      if (round >= minRounds) return finish();
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
    const fix = `${context}\n\n=== ПРЕДЫДУЩИЙ ПЛАН ===\n${plan}\n\n=== ЗАМЕЧАНИЯ РЕВЬЮЕРА ===\n${feedback}`;
    plan = (await run(coach, fix)).finalOutput ?? plan;
  }

  // Одобрение могло случиться раньше, а последний раунд его не подтвердить —
  // тогда в output.md уже лежит одобренный план и «ничего не записано» было бы неправдой
  const approved = finalRound(history.all())!;
  console.log(
    approved.review.verdict === 'approve'
      ? `\nПоследний раунд одобрения не дал — возвращаю одобренный план из раунда ${approved.round}, он и лежит в data/output.md.`
      : `\nПлан не одобрен за ${maxRounds} раунда(ов) — в data/output.md ничего не записано.`,
  );
  return finish();
}

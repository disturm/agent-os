import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import OpenAI from 'openai';
import { run, setDefaultOpenAIClient, setOpenAIAPI, setTracingDisabled } from '@openai/agents';
import { coach } from '../agents/healthCoach';
import { reviewer, ReviewSchema, type Review } from '../agents/safetyReviewer';

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
  rounds: number;
};

// Достаём JSON из ответа модели (модель может обернуть его в ```json)
function parseReview(text: string): Review | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    const parsed = ReviewSchema.safeParse(JSON.parse(text.slice(start, end + 1)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

// Ревью с одним ретраем на невалидный JSON
async function review(plan: string, context: string): Promise<Review> {
  const prompt = `${context}\n\n=== ПЛАН НА ПРОВЕРКУ ===\n${plan}`;
  for (const attempt of [1, 2]) {
    const suffix = attempt === 1 ? '' : '\n\nПрошлый ответ был невалидным. Верни ТОЛЬКО JSON нужной формы.';
    const result = await run(reviewer, prompt + suffix);
    const parsed = parseReview(result.finalOutput ?? '');
    if (parsed) return parsed;
    console.warn('  ! ревьюер вернул невалидный JSON, повтор запроса');
  }
  throw new Error('Ревьюер дважды вернул невалидный JSON');
}

// --- Оркестрация ---
const MAX_ROUNDS = 3;

export async function runHealthAgent(task: string): Promise<AgentResult> {
  // Контекст = профиль + дневник + задача
  const profile = readFileSync(dataFile('profile.md'), 'utf8');
  const log = readFileSync(dataFile('log.md'), 'utf8');
  const context = `=== ПРОФИЛЬ ПОЛЬЗОВАТЕЛЯ ===\n${profile}\n\n=== ДНЕВНИК ПОСЛЕДНИХ ДНЕЙ ===\n${log}\n\n=== ЗАДАЧА ===\n${task}`;

  console.log(`Задача: ${task}\nМодель: ${MODEL}\n`);
  let plan = (await run(coach, context)).finalOutput ?? '';
  let last: Review;

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    last = await review(plan, context);
    const { verdict, score, issues } = last;
    console.log(`Раунд ${round}: verdict=${verdict}, score=${score}`);
    for (const issue of issues) console.log(`  - ${issue}`);

    // Медицинский запрос — дальше не идём
    if (verdict === 'needs_human_professional') {
      console.log('\nЗапрос требует человека-специалиста (врача). Агент не даёт медицинских рекомендаций — план не сохранён.');
      return { plan, review: last, rounds: round };
    }

    if (verdict === 'approve') {
      writeFileSync(dataFile('output.md'), `# ${task}\n\n${plan}\n\n---\nSafety score: ${score}/10, раундов: ${round}\n`, 'utf8');
      console.log(`\nПлан сохранён в data/output.md. Score: ${score}/10`);
      return { plan, review: last, rounds: round };
    }

    // verdict === 'revise': отдаём issues обратно коучу
    if (round === MAX_ROUNDS) break;
    console.log('  → отправляю замечания коучу\n');
    const fix = `${context}\n\n=== ПРЕДЫДУЩИЙ ПЛАН ===\n${plan}\n\n=== ЗАМЕЧАНИЯ РЕВЬЮЕРА ===\n${issues.map((i) => `- ${i}`).join('\n')}\n\nПерепиши план целиком с учётом замечаний.`;
    plan = (await run(coach, fix)).finalOutput ?? plan;
  }

  console.log(`\nПлан не одобрен за ${MAX_ROUNDS} раунда(ов) — в data/output.md ничего не записано.`);
  return { plan, review: last!, rounds: MAX_ROUNDS };
}

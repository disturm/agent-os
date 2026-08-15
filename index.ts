import 'dotenv/config';
import { readFileSync, writeFileSync } from 'node:fs';
import OpenAI from 'openai';
import { Agent, run, setDefaultOpenAIClient, setOpenAIAPI, setTracingDisabled } from '@openai/agents';
import { z } from 'zod';

// --- Провайдер: DeepSeek через OpenAI-совместимый API ---
const apiKey = process.env.DEEPSEEK_API_KEY;
if (!apiKey) {
  console.error('Нет DEEPSEEK_API_KEY в .env (см. .env.example)');
  process.exit(1);
}
setDefaultOpenAIClient(new OpenAI({ baseURL: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com', apiKey }));
setOpenAIAPI('chat_completions'); // DeepSeek говорит на /chat/completions, не на Responses API
setTracingDisabled(true);
const MODEL = process.env.DEEPSEEK_MODEL ?? 'deepseek-v4-pro';

// --- Системные промпты агентов ---
const COACH_PROMPT = `Ты — Health Coach: wellness-коуч по питанию, тренировкам, восстановлению и привычкам.
Ты работаешь только с контекстом, который тебе дали: профиль пользователя и дневник последних дней.

Формат ответа — markdown-план:
# План
## Цель дня
## Питание (приёмы пищи, ориентировочные порции)
## Активность (упражнения, объём, интенсивность)
## Восстановление (сон, отдых)
## Заметки (на что смотреть в самочувствии)

Правила:
- Опирайся на профиль и дневник, учитывай ограничения и предпочтения.
- Давай конкретику: время, продукты, подходы, минуты. Никакой воды.
- ЗАПРЕЩЕНО: ставить диагнозы, назначать/подбирать лекарства и БАДы, интерпретировать анализы,
  советовать лечение, дозировки, экстремальный дефицит калорий или голодание.
- Если запрос по сути медицинский — не выполняй его, а прямо напиши, что нужен врач или профильный специалист.`;

const REVIEWER_PROMPT = `Ты — Safety Reviewer. Проверяешь план wellness-коуча по трём критериям:
1) Безопасность: нет диагнозов, лекарств, БАДов, дозировок, лечения, опасных нагрузок и экстремальных ограничений в еде.
2) Реалистичность: план выполним за день, объёмы и время адекватны.
3) Соответствие профилю: учтены цели, ограничения (травмы, аллергии, непереносимости) и предпочтения из профиля и дневника.

Вердикты:
- "approve" — план безопасен и годен.
- "revise" — есть исправимые проблемы, перечисли их в issues.
- "needs_human_professional" — задача или план требуют врача/профильного специалиста (лекарства, диагноз, анализы, лечение).

score — насколько план готов к выполнению как есть, а не насколько удачно коуч ответил:
- 9–10 только вместе с "approve";
- 4–8 для "revise";
- 0–3 для "needs_human_professional" — выполнимого плана нет, даже если отказ коуча был правильным.

Отвечай ТОЛЬКО одним JSON-объектом, без markdown-обёрток и текста вокруг:
{"verdict":"approve"|"revise"|"needs_human_professional","score":0-10,"issues":["..."]}`;

const coach = new Agent({ name: 'Health Coach', model: MODEL, instructions: COACH_PROMPT });
const reviewer = new Agent({ name: 'Safety Reviewer', model: MODEL, instructions: REVIEWER_PROMPT });

// --- Схема ответа ревьюера ---
const ReviewSchema = z.object({
  verdict: z.enum(['approve', 'revise', 'needs_human_professional']),
  score: z.number().min(0).max(10),
  issues: z.array(z.string()),
});
type Review = z.infer<typeof ReviewSchema>;

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

async function main(): Promise<number> {
  const task = process.argv[2];
  if (!task) {
    console.error('Использование: npx tsx index.ts "составь план питания на завтра"');
    return 1;
  }

  // Контекст = профиль + дневник + задача
  const profile = readFileSync('profile.md', 'utf8');
  const log = readFileSync('log.md', 'utf8');
  const context = `=== ПРОФИЛЬ ПОЛЬЗОВАТЕЛЯ ===\n${profile}\n\n=== ДНЕВНИК ПОСЛЕДНИХ ДНЕЙ ===\n${log}\n\n=== ЗАДАЧА ===\n${task}`;

  console.log(`Задача: ${task}\nМодель: ${MODEL}\n`);
  let plan = (await run(coach, context)).finalOutput ?? '';

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const { verdict, score, issues } = await review(plan, context);
    console.log(`Раунд ${round}: verdict=${verdict}, score=${score}`);
    for (const issue of issues) console.log(`  - ${issue}`);

    // Медицинский запрос — дальше не идём
    if (verdict === 'needs_human_professional') {
      console.log('\nЗапрос требует человека-специалиста (врача). Агент не даёт медицинских рекомендаций — план не сохранён.');
      return 0;
    }

    if (verdict === 'approve') {
      writeFileSync('output.md', `# ${task}\n\n${plan}\n\n---\nSafety score: ${score}/10, раундов: ${round}\n`, 'utf8');
      console.log(`\nПлан сохранён в output.md. Score: ${score}/10`);
      return 0;
    }

    // verdict === 'revise': отдаём issues обратно коучу
    if (round === MAX_ROUNDS) break;
    console.log('  → отправляю замечания коучу\n');
    const fix = `${context}\n\n=== ПРЕДЫДУЩИЙ ПЛАН ===\n${plan}\n\n=== ЗАМЕЧАНИЯ РЕВЬЮЕРА ===\n${issues.map((i) => `- ${i}`).join('\n')}\n\nПерепиши план целиком с учётом замечаний.`;
    plan = (await run(coach, fix)).finalOutput ?? plan;
  }

  console.log(`\nПлан не одобрен за ${MAX_ROUNDS} раунда(ов) — в output.md ничего не записано.`);
  return 1;
}

process.exitCode = await main().catch((err: unknown) => {
  console.error(`Ошибка: ${err instanceof Error ? err.message : String(err)}`);
  return 1;
});

import { Agent } from '@openai/agents';
import { z } from 'zod';

const MODEL = process.env.DEEPSEEK_MODEL ?? 'deepseek-v4-pro';

// --- Системный промпт ревьюера ---
export const REVIEWER_PROMPT = `Ты — Safety Reviewer. Проверяешь план wellness-коуча по трём критериям:
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

export const reviewer = new Agent({ name: 'Safety Reviewer', model: MODEL, instructions: REVIEWER_PROMPT });

// --- Схема ответа ревьюера ---
export const ReviewSchema = z.object({
  verdict: z.enum(['approve', 'revise', 'needs_human_professional']),
  score: z.number().min(0).max(10),
  issues: z.array(z.string()),
});
export type Review = z.infer<typeof ReviewSchema>;

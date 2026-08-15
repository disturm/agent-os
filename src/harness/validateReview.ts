/**
 * Контроль формы ответа ревьюера: схема, извлечение JSON и политика ретрая.
 *
 * Модель отвечает свободным текстом, а loop-у нужен типизированный вердикт — здесь
 * проходит граница между «что сказала модель» и «с чем работает harness».
 * Сам вызов модели сюда не заходит: его передают колбэком `ask`, поэтому модуль
 * ничего не знает ни об агентах, ни о провайдере.
 */

import { z } from 'zod';

/** Форма ответа ревьюера — единственный контракт, которому он обязан соответствовать. */
export const ReviewSchema = z.object({
  verdict: z.enum(['approve', 'revise', 'needs_human_professional']),
  score: z.number().min(0).max(10),
  issues: z.array(z.string()),
});
export type Review = z.infer<typeof ReviewSchema>;

/** Добавка к промпту на второй попытке. Часть политики ретрая, а не системного промпта ревьюера. */
const RETRY_HINT = '\n\nПрошлый ответ был невалидным. Верни ТОЛЬКО JSON нужной формы.';

/** Достаём JSON из ответа модели (модель может обернуть его в ```json). */
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

/**
 * Спрашивает ревьюера и валидирует ответ. Один ретрай с подсказкой о формате,
 * после второго провала — throw: молча продолжать loop с мусором нельзя.
 *
 * @param ask вызов ревьюера; получает добавку к промпту (пустую на первой попытке)
 */
export async function validateReview(ask: (retryHint: string) => Promise<string>): Promise<Review> {
  for (const attempt of [1, 2]) {
    const parsed = parseReview(await ask(attempt === 1 ? '' : RETRY_HINT));
    if (parsed) return parsed;
    console.warn('  ! ревьюер вернул невалидный JSON, повтор запроса');
  }
  throw new Error('Ревьюер дважды вернул невалидный JSON');
}

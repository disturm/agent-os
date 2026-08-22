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

/**
 * Тот же контракт, но для провайдера: нативный JSON-режим (`docs/specB.md`).
 *
 * Схема здесь ровно одна и выводится из `ReviewSchema` — вручную продублировать её в JSON
 * значило бы завести второй источник правды, который разъедется с Zod на первой же правке.
 * Конвертер встроен в zod v4, поэтому пакета `zod-to-json-schema` в зависимостях нет.
 *
 * `strict` требует, чтобы модель не добавляла своих полей; `additionalProperties: false`
 * для этого обязателен, и zod его проставляет сам.
 *
 * Живёт в этом модуле, а не в `src/agents/safetyReviewer.ts`, по той же причине, по которой
 * здесь же лежит парсер: это всё описание одного контракта — «что считается ответом ревьюера».
 * Агент только предъявляет его провайдеру.
 */
/**
 * Ключевые слова, которые в strict-режиме структурированного вывода не принимаются.
 *
 * Zod выводит из `.min(0).max(10)` честные `minimum`/`maximum`, а провайдеры на них отвечают
 * ошибкой «unsupported keyword» — и запрос падает целиком, ещё до того как модель что-то
 * скажет. `$schema` в теле запроса не нужен по той же причине.
 *
 * Потерять здесь нечего: диапазон score проверяет `ReviewSchema` при разборе ответа. Схема
 * на проводе отвечает за форму («какие поля и каких типов»), а за границы значений — Zod.
 */
const UNSUPPORTED_KEYWORDS = new Set([
  '$schema',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minLength',
  'maxLength',
  'pattern',
  'format',
  'minItems',
  'maxItems',
]);

/**
 * Рекурсивно чистит схему от того, чего strict-режим не понимает.
 *
 * Объявлено ДО `REVIEW_RESPONSE_FORMAT` не для красоты: константа считается на загрузке
 * модуля, и `UNSUPPORTED_KEYWORDS` ниже по файлу оказался бы в temporal dead zone —
 * импорт падал бы с `Cannot access before initialization`. Функция всплывает, `const` нет.
 */
function forProvider(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(forProvider);
  if (!schema || typeof schema !== 'object') return schema;

  return Object.fromEntries(
    Object.entries(schema as Record<string, unknown>)
      .filter(([key]) => !UNSUPPORTED_KEYWORDS.has(key))
      .map(([key, value]) => [key, forProvider(value)]),
  );
}

export const REVIEW_RESPONSE_FORMAT = {
  type: 'json_schema',
  json_schema: {
    name: 'safety_review',
    strict: true,
    schema: forProvider(z.toJSONSchema(ReviewSchema)),
  },
} as const;

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
 * Результат проверки: вердикт и сколько раз пришлось переспрашивать.
 *
 * Счётчик — не отладочный вывод, а метрика этапа (`docs/specB.md`): до нативного JSON-режима
 * ретрай срабатывал регулярно, после него обязан не срабатывать вовсе. Возвращается наружу,
 * а не пишется в лог на месте, потому что копит его harness — по всем раундам сразу.
 */
export type ReviewOutcome = {
  review: Review;
  retries: number;
};

/**
 * Спрашивает ревьюера и валидирует ответ. Один ретрай с подсказкой о формате,
 * после второго провала — throw: молча продолжать loop с мусором нельзя.
 *
 * Страховка осталась на месте и после перехода на `response_format` (`docs/specB.md`):
 * нативный JSON-режим гарантирует форму, только если его поддержала выбранная модель,
 * а модель на OpenRouter меняется одной переменной в `.env`. Ноль в счётчике — это
 * наблюдение, а не допущение, на котором держится цикл.
 *
 * @param ask вызов ревьюера; получает добавку к промпту (пустую на первой попытке)
 */
export async function validateReview(ask: (retryHint: string) => Promise<string>): Promise<ReviewOutcome> {
  for (const attempt of [1, 2]) {
    const parsed = parseReview(await ask(attempt === 1 ? '' : RETRY_HINT));
    if (parsed) return { review: parsed, retries: attempt - 1 };
    console.warn('  ! ревьюер вернул невалидный JSON, повтор запроса');
  }
  throw new Error('Ревьюер дважды вернул невалидный JSON');
}

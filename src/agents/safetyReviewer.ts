import { Agent } from '@openai/agents';
import { providerSettings, REVIEWER_MODEL } from '../harness/provider';
import { REVIEW_RESPONSE_FORMAT } from '../harness/validateReview';

/**
 * Safety Reviewer: проверяет план коуча и возвращает JSON-вердикт.
 *
 * Системный промпт живёт в `prompts/safetyReviewer.<версия>.md`, схема ответа и
 * ретрай на невалидный JSON — в `src/harness/validateReview.ts`.
 *
 * ВАЖНО: инструментов у ревьюера нет и быть не должно. Он контролёр, а не участник:
 * на входе только текст плана, на выходе только вердикт, никаких побочных эффектов —
 * ни чтения файлов, ни записи. Дать ему `save_health_plan` значило бы разрешить проверяющему
 * менять то, что он проверяет; дать чтение данных — сделать вердикт зависимым от
 * состояния диска, а не от текста, который увидел пользователь. MCP-сервер к ревьюеру
 * не подключается по той же причине: контролёру инструменты не нужны в принципе.
 */
export function createReviewer(instructions: string) {
  return new Agent({
    name: 'Safety Reviewer',
    model: REVIEWER_MODEL,
    // Нативный JSON-режим провайдера (`docs/specB.md`): форму ответа теперь гарантирует
    // не уговор в промпте, а сам запрос. Требование «верни только JSON» из
    // `prompts/safetyReviewer.v2.md` при этом не убрано — промпт остаётся валидным
    // и без этого режима, а `validateReview` остаётся страховкой: модель на OpenRouter
    // меняется одной строкой в `.env`, и не всякая поддерживает json_schema.
    //
    // `outputType: ReviewSchema` дал бы то же самое короче, но вернул бы готовый объект,
    // и парсер пришлось бы кормить обратной сериализацией — страховка превратилась
    // бы в формальность, а счётчик ретраев перестал что-либо значить.
    modelSettings: providerSettings({ response_format: REVIEW_RESPONSE_FORMAT }),
    instructions,
    tools: [],
  });
}

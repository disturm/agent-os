import { Agent } from '@openai/agents';

const MODEL = process.env.DEEPSEEK_MODEL ?? 'deepseek-v4-pro';

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
  return new Agent({ name: 'Safety Reviewer', model: MODEL, instructions, tools: [] });
}

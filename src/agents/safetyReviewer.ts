import { Agent } from '@openai/agents';

const MODEL = process.env.DEEPSEEK_MODEL ?? 'deepseek-v4-pro';

/**
 * Safety Reviewer: проверяет план коуча и возвращает JSON-вердикт.
 *
 * Системный промпт живёт в `prompts/safetyReviewer.<версия>.md`, схема ответа и
 * ретрай на невалидный JSON — в `src/harness/validateReview.ts`.
 */
export function createReviewer(instructions: string) {
  return new Agent({ name: 'Safety Reviewer', model: MODEL, instructions });
}

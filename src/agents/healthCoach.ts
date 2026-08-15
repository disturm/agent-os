import { Agent } from '@openai/agents';

const MODEL = process.env.DEEPSEEK_MODEL ?? 'deepseek-v4-pro';

/**
 * Health Coach: пишет wellness-план по профилю и дневнику.
 *
 * Системный промпт живёт в `prompts/healthCoach.<версия>.md` — сюда он приходит
 * готовым текстом, версию выбирает harness (`promptVersions.ts`).
 */
export function createCoach(instructions: string) {
  return new Agent({ name: 'Health Coach', model: MODEL, instructions });
}

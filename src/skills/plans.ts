/**
 * Skill: сохранение итогового плана в `data/output.md`.
 *
 * Единственный инструмент коуча с необратимым эффектом наружу, поэтому право на вызов
 * выдаёт harness: в набор агента `savePlan` попадает только после `approve` ревьюера
 * (см. `saveApprovedPlan` в `src/harness/runHealthAgent.ts`). Сам модуль ни о каком
 * одобрении не знает — его дело записать переданный текст.
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tool } from '@openai/agents';
import { z } from 'zod';

export const savePlan = tool({
  name: 'savePlan',
  description: [
    'Сохраняет итоговый план в data/output.md, перезаписывая прежний.',
    'Вызывай только тогда, когда план уже одобрен ревьюером и его просят зафиксировать:',
    'это точка невозврата, черновики и промежуточные версии сюда не пишут.',
    'Передавай план целиком и без изменений — файл станет ровно тем, что ты передал.',
    'Возвращает ok и число сохранённых символов.',
  ].join(' '),
  parameters: z.object({
    markdown: z
      .string()
      .min(1)
      .describe('Полный текст плана в markdown, вместе с заголовками разделов. Не сокращать и не пересказывать.'),
  }),
  execute: async ({ markdown }) => {
    const text = `${markdown.trim()}\n`;
    writeFileSync(join(process.cwd(), 'data', 'output.md'), text, 'utf8');
    return `ok: план сохранён в data/output.md (${text.length} символов)`;
  },
});

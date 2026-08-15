/**
 * Skill: дневник последних дней.
 *
 * Отдаёт не весь `data/log.md`, а хвост запрошенной длины: агент сам решает, насколько
 * глубоко ему смотреть. Нарезка по дням живёт здесь, потому что формат файла —
 * ответственность этого модуля, а не того, кто задаёт число дней.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tool } from '@openai/agents';
import { z } from 'zod';

/** День в дневнике — раздел второго уровня (`## 14 августа, четверг`). Шапка файла в разделы не попадает. */
function recentDays(markdown: string, days: number): string {
  const entries = markdown.split(/\n(?=## )/).filter((chunk) => chunk.startsWith('## '));
  // Разметка непривычная — лучше отдать файл целиком, чем пустоту
  if (entries.length === 0) return markdown.trim();
  return entries.slice(-days).join('\n').trim();
}

export const getRecentLog = tool({
  name: 'getRecentLog',
  description: [
    'Возвращает последние записи из дневника пользователя как markdown: по дню на раздел —',
    'что ел, сколько пил воды, как спал, была ли тренировка, самочувствие.',
    'Вызывай, когда задача касается текущего состояния, привычек, нагрузки или содержит слова',
    'вроде «с учётом моего лога», «за последние дни», «как я спал».',
    'Профиль это не заменяет: в дневнике нет целей и ограничений.',
    'Записей в файле может быть меньше, чем запрошено, — тогда вернутся все, что есть.',
  ].join(' '),
  parameters: z.object({
    days: z
      .number()
      .int()
      .min(1)
      .max(30)
      .describe('Сколько последних дней вернуть. Разумный запрос — 3–7 дней; больше 7 нужно редко.'),
  }),
  execute: async ({ days }) => recentDays(readFileSync(join(process.cwd(), 'data', 'log.md'), 'utf8'), days),
});

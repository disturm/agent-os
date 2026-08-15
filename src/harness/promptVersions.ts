/**
 * Загрузка системных промптов из `prompts/<файл>.<версия>.md`.
 *
 * Промпт — это конфигурация агента, а не код: чтобы поменять поведение, достаточно
 * положить рядом `healthCoach.v2.md` и переключить `ACTIVE_PROMPTS.coach` на `'v2'`.
 * Ответственность модуля заканчивается на «отдать текст версии» — кто и как его
 * применяет, решает оркестратор.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Кто есть кто в `prompts/`: ключ роли → базовое имя файла. */
const PROMPT_FILES = {
  coach: 'healthCoach',
  reviewer: 'safetyReviewer',
} as const;

export type PromptRole = keyof typeof PROMPT_FILES;

/** Версии, с которыми идёт прогон. Единственное место, где они выбираются. */
export const ACTIVE_PROMPTS: PromptVersions = { coach: 'v1', reviewer: 'v1' };

/** Слепок версий: уезжает в результат прогона, чтобы ответ можно было соотнести с промптом. */
export type PromptVersions = Record<PromptRole, string>;

/** Читает конкретную версию промпта. Файла нет — падаем сразу, а не после платного вызова модели. */
export function loadPrompt(role: PromptRole, version: string): string {
  const path = join(process.cwd(), 'prompts', `${PROMPT_FILES[role]}.${version}.md`);
  try {
    // trim: в файле есть завершающий перевод строки, в промпте он лишний
    return readFileSync(path, 'utf8').trim();
  } catch {
    throw new Error(`Нет файла промпта ${PROMPT_FILES[role]}.${version}.md (искали в prompts/)`);
  }
}

/** Промпт активной версии — то, что нужно оркестратору в 99% случаев. */
export function loadActivePrompt(role: PromptRole): string {
  return loadPrompt(role, ACTIVE_PROMPTS[role]);
}

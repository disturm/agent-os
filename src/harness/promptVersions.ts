/**
 * Загрузка системных промптов: Langfuse, а если его нет — `prompts/<файл>.<версия>.md`.
 *
 * Промпт — это конфигурация агента, а не код: чтобы поменять поведение, достаточно
 * положить рядом `healthCoach.v2.md` и переключить `ACTIVE_PROMPTS.coach` на `'v2'`.
 * Ответственность модуля заканчивается на «отдать текст версии» — кто и как его
 * применяет, решает оркестратор.
 *
 * По `docs/specB.md` у промптов появился второй источник — Langfuse Prompt Management,
 * и он приоритетный: правка промпта перестала быть деплоем. Файлы при этом никуда не делись
 * и остаются полноценным fallback-ом, а не архивом: убрал `LANGFUSE_*` из `.env` — прогон
 * пошёл по `prompts/*.md`, как до specB.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fetchPrompt } from '../langfuse/prompts';

/** Кто есть кто в `prompts/`: ключ роли → базовое имя файла. Оно же — имя промпта в Langfuse. */
const PROMPT_FILES = {
  coach: 'healthCoach',
  reviewer: 'safetyReviewer',
} as const;

export type PromptRole = keyof typeof PROMPT_FILES;

/** Имя промпта в Langfuse. Совпадает с базовым именем файла — чтобы искать по одному слову. */
export function promptName(role: PromptRole): string {
  return PROMPT_FILES[role];
}

/** Версии, с которыми идёт прогон. Единственное место, где они выбираются. */
export const ACTIVE_PROMPTS: PromptVersions = { coach: 'v6', reviewer: 'v2' };

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

/** Промпт активной версии из файла. Он же — fallback, когда Langfuse выключен или недоступен. */
export function loadActivePrompt(role: PromptRole): string {
  return loadPrompt(role, ACTIVE_PROMPTS[role]);
}

/** Откуда взялся текст промпта. Уезжает в лог: расхождение прогонов начинается именно отсюда. */
export type ResolvedPrompt = {
  text: string;
  /** `v6` — файл, `langfuse:7` — платформа. Формат прежний (строка), поэтому replay не ломается. */
  version: string;
  source: 'langfuse' | 'file';
};

/**
 * Промпт для прогона: сначала Langfuse, потом файл (`docs/specB.md`).
 *
 * Файл читается в любом случае и **до** обращения к платформе — он уезжает туда параметром
 * `fallback`. Так недоступный Langfuse означает не сломанный прогон, а прогон по локальной
 * версии; ронять его из-за наблюдаемости нельзя, это не предохранитель.
 */
export async function resolvePrompt(role: PromptRole): Promise<ResolvedPrompt> {
  const local = loadActivePrompt(role);
  const remote = await fetchPrompt(promptName(role), local);
  return remote
    ? { text: remote.text, version: `langfuse:${remote.version}`, source: 'langfuse' }
    : { text: local, version: ACTIVE_PROMPTS[role], source: 'file' };
}

/**
 * Специализация модуля OS: `prompts/modules/<файл>` (`docs/specA.md`).
 *
 * Версий у этих файлов нет намеренно: версионируется базовый промпт коуча, а специализация —
 * приписка к нему, и её история читается по git. Чтение живёт здесь, потому что `prompts/`
 * читает этот модуль и только он; склейка с базовым промптом — уже дело OS (`src/os/runOS.ts`).
 */
export function loadModulePrompt(file: string): string {
  const path = join(process.cwd(), 'prompts', 'modules', file);
  try {
    return readFileSync(path, 'utf8').trim();
  } catch {
    throw new Error(`Нет файла промпта модуля ${file} (искали в prompts/modules/)`);
  }
}

/**
 * Промпты из Langfuse Prompt Management (`docs/specB.md`).
 *
 * Приоритет — Langfuse, запасной вариант — локальный `prompts/*.md`. Смысл именно в этом
 * порядке: правка промпта перестаёт быть деплоем. Поменял label `production` в UI —
 * следующий прогон пошёл по новой редакции, сборка при этом не пересобиралась.
 *
 * Локальный файл при этом не «на всякий случай», а полноценный fallback: он уезжает в SDK
 * параметром `fallback`, поэтому недоступный Langfuse означает не сломанный прогон, а прогон
 * по файлу — ровно как до specB. Проверить это можно, убрав `LANGFUSE_*` из `.env`.
 */

import { langfuseClient, quietly } from './client';

/** Label, по которому берётся «боевая» версия. Меняется в UI Langfuse, а не в коде. */
const LABEL = process.env.LANGFUSE_PROMPT_LABEL?.trim() || 'production';

export type FetchedPrompt = {
  text: string;
  /** Номер версии в Langfuse. Уезжает в трейс, чтобы ответ можно было соотнести с промптом. */
  version: number;
};

/**
 * Промпт по имени. `null` — Langfuse выключен или отдал fallback, то есть вызывающему
 * надо читать файл самому (он и так это умеет — см. `promptVersions.ts`).
 *
 * @param name имя промпта в Langfuse; совпадает с базовым именем файла в `prompts/`
 * @param fallback текст локальной версии: уезжает в SDK, чтобы сбой сети не ронял прогон
 */
export async function fetchPrompt(name: string, fallback: string): Promise<FetchedPrompt | null> {
  const client = langfuseClient();
  if (!client) return null;

  const prompt = await quietly(`промпт ${name} не получен`, () =>
    client.prompt.get(name, { label: LABEL, fallback, type: 'text' }),
  );

  // isFallback означает «Langfuse не ответил, держи свой же текст». Возвращаем null:
  // версию такого промпта показывать нельзя, её попросту нет, и в трейс уедет локальная.
  if (!prompt || prompt.isFallback) return null;
  return { text: prompt.prompt, version: prompt.version };
}

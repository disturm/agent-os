/**
 * Клиент Langfuse и правило включения (`docs/specB.md`).
 *
 * Единственное место, где решается «включён ли Langfuse». Ответ — «есть ли обе половины
 * ключа»: без них клиент не создаётся вовсе, и весь слой превращается в набор no-op.
 * Отсюда требование спеки — удалить `LANGFUSE_*` из `.env`, и приложение работает
 * полностью на локальных файлах: `runs/*.json` и `prompts/*.md` никуда не делись.
 *
 * Env читается **лениво, на каждый вызов**, а не на загрузке модуля — ровно как в `src/rag/`.
 * Прочитай мы его на импорте, отсутствующий ключ ронял бы роут целиком, хотя без Langfuse
 * прогон обязан идти как ни в чём не бывало.
 */

import { LangfuseClient } from '@langfuse/client';

const DEFAULT_BASE_URL = 'https://cloud.langfuse.com';

/** Один клиент на процесс: у него внутри кэш промптов и очередь scores, плодить их незачем. */
let cached: LangfuseClient | undefined;

/** Включён ли Langfuse. Нужны обе половины ключа: с одной API всё равно ответит 401. */
export function isLangfuseEnabled(): boolean {
  return Boolean(process.env.LANGFUSE_PUBLIC_KEY?.trim() && process.env.LANGFUSE_SECRET_KEY?.trim());
}

/**
 * Клиент или `null`, если Langfuse выключен.
 *
 * `LANGFUSE_BASE_URL` — та самая переменная, которой выбирается self-host против cloud
 * (`docker-compose.yml` поднимает web на 3001: 3000 занят `next dev`) и регион cloud.
 *
 * Имя совпадает с тем, что SDK читает из окружения сам, и это не совпадение: разойдись
 * они, конфиг работал бы «через раз» — там, где мы передаём параметры явно, брался бы наш,
 * а в любом коде, создавшем клиент без аргументов, молча подставился бы другой хост.
 * Передаём всё равно явно: правило включения живёт здесь, а не в умолчаниях библиотеки.
 */
export function langfuseClient(): LangfuseClient | null {
  if (!isLangfuseEnabled()) return null;
  cached ??= new LangfuseClient({
    publicKey: process.env.LANGFUSE_PUBLIC_KEY,
    secretKey: process.env.LANGFUSE_SECRET_KEY,
    baseUrl: process.env.LANGFUSE_BASE_URL?.trim() || DEFAULT_BASE_URL,
  });
  return cached;
}

/**
 * Обёртка «наблюдаемость не роняет прогон» — единственное место, где это правило записано.
 *
 * Причина та же, по которой не бросает `saveTrace`: к моменту отправки прогон уже состоялся
 * и оплачен, и менять готовый план на исключение из-за недоступного Langfuse — плохой обмен.
 * Поэтому здесь `catch` с предупреждением, а не проброс.
 */
export async function quietly<T>(what: string, action: () => Promise<T>): Promise<T | undefined> {
  try {
    return await action();
  } catch (err: unknown) {
    console.warn(`! Langfuse: ${what} — ${err instanceof Error ? err.message : String(err)}`);
    return undefined;
  }
}

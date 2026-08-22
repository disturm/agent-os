/**
 * Провайдер модели: OpenAI-совместимый шлюз, по умолчанию OpenRouter (`docs/specB.md`).
 *
 * Единственное место, где он настраивается. Отдельный модуль, потому что настройка — это
 * побочный эффект на загрузке, и полагаться на то, что его выполнит какой-то другой файл,
 * нельзя: до `docs/specA.md` она жила в `runHealthAgent.ts`, и роутер работал только потому,
 * что `runOS` импортировал harness первым. Стоило импортировать `router.ts` в одиночку — и
 * SDK шёл в OpenAI с пустым ключом, ругаясь на отсутствие `OPENAI_API_KEY`.
 *
 * По `docs/specB.md` отсюда же раздаются идентификаторы моделей, и это закрывает ту же дыру
 * надёжнее: раньше `DEEPSEEK_MODEL` читали из env три файла независимо (`healthCoach.ts`,
 * `safetyReviewer.ts`, `router.ts`), и импорт провайдера оставался вопросом дисциплины.
 * Теперь имя модели приходит только отсюда, то есть зависимость обязательна по типам.
 *
 * Имена переменных нейтральные (`LLM_*`), а не `OPENROUTER_*`: OpenRouter здесь — это baseURL,
 * а не особый код. Благодаря этому «учебный вариант» из `.env.example` (прямой DeepSeek)
 * остаётся рабочим — те же переменные, другие значения.
 *
 * ВАЖНО: `.env` должен быть загружен до импорта — env читается здесь, на загрузке.
 * В CLI и скриптах это делает `import 'dotenv/config'` первой строкой, в приложении — Next.
 */

import OpenAI from 'openai';
import { setDefaultOpenAIClient, setOpenAIAPI, setTracingDisabled, type ModelSettings } from '@openai/agents';

const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';

const apiKey = process.env.LLM_API_KEY;
if (!apiKey) throw new Error('Нет LLM_API_KEY в .env (см. .env.example)');

const baseURL = process.env.LLM_BASE_URL?.trim() || DEFAULT_BASE_URL;

/**
 * Ходим ли мы через OpenRouter. От этого зависят два необязательных параметра тела запроса —
 * `models` (fallback) и `usage` (учёт стоимости): они специфичны для шлюза, и слать их
 * прямому DeepSeek нельзя — он отвергает неизвестные поля, и прогон падает до первого плана.
 */
const IS_OPENROUTER = baseURL.includes('openrouter.ai');

setDefaultOpenAIClient(
  new OpenAI({
    baseURL,
    apiKey,
    // OpenRouter просит их для атрибуции запросов; остальным шлюзам они безразличны.
    defaultHeaders: IS_OPENROUTER
      ? { 'HTTP-Referer': process.env.LLM_APP_URL?.trim() || 'http://localhost:3000', 'X-Title': 'Agentic Wellness OS' }
      : undefined,
  }),
);
setOpenAIAPI('chat_completions'); // ни DeepSeek, ни OpenRouter не говорят на Responses API
setTracingDisabled(true);

/**
 * Три модели вместо одной (`docs/specB.md`). Раздельные, потому что задачи разные:
 * коуч пишет текст, ревьюер выносит вердикт, роутер выбирает слово из девяти.
 *
 * Дефолты намеренно повторяют поведение до specB (коуч и ревьюер — pro, роутер — flash).
 * Спека предлагает сплит «коуч подешевле, ревьюер построже», но включать его дефолтом —
 * значит незаметно сдвинуть результаты всех evals; рекомендованный вариант расписан
 * комментарием в `.env.example` и включается одной строкой.
 */
export const AGENT_MODEL = process.env.AGENT_MODEL?.trim() || 'deepseek/deepseek-v4-pro';
export const REVIEWER_MODEL = process.env.REVIEWER_MODEL?.trim() || 'deepseek/deepseek-v4-pro';
export const ROUTER_MODEL = process.env.ROUTER_MODEL?.trim() || 'deepseek/deepseek-v4-flash';

/**
 * Модель прогона. Алиас `AGENT_MODEL`, оставленный ради совместимости: имя `MODEL` уезжает
 * в трейс и читается `scripts/replay.ts`, а формат трейса менять этот этап не должен.
 */
export const MODEL = AGENT_MODEL;

/** Запасная модель коуча. Пусто — fallback не настроен, запрос идёт обычным образом. */
const AGENT_FALLBACK_MODEL = process.env.AGENT_FALLBACK_MODEL?.trim();

/**
 * Настройки запроса к шлюзу.
 *
 * `usage: { include: true }` — просьба к OpenRouter вернуть фактическую стоимость вызова:
 * без неё в Langfuse уехали бы одни токены, а цену пришлось бы досчитывать по чужому прайсу.
 * `models` — fallback средствами шлюза (`docs/specB.md`): не «повтори другой моделью» в нашем
 * коде, а список приоритетов в одном запросе, поэтому ретраев в harness не прибавляется.
 *
 * @param extra параметры провайдера сверх общих — например `response_format` у ревьюера
 * @param fallback добавить ли запасную модель (только коуч; ревьюеру и роутеру она не нужна)
 */
export function providerSettings(extra: Record<string, unknown> = {}, fallback = false): ModelSettings {
  if (!IS_OPENROUTER) return { providerData: { ...extra } };

  const models = fallback && AGENT_FALLBACK_MODEL ? { models: [AGENT_MODEL, AGENT_FALLBACK_MODEL] } : {};
  return { providerData: { usage: { include: true }, ...models, ...extra } };
}

/**
 * Провайдер модели: DeepSeek через OpenAI-совместимый API.
 *
 * Единственное место, где он настраивается. Отдельный модуль, потому что настройка — это
 * побочный эффект на загрузке, и полагаться на то, что его выполнит какой-то другой файл,
 * нельзя: до `docs/specA.md` она жила в `runHealthAgent.ts`, и роутер работал только потому,
 * что `runOS` импортировал harness первым. Стоило импортировать `router.ts` в одиночку — и
 * SDK шёл в OpenAI с пустым ключом, ругаясь на отсутствие `OPENAI_API_KEY`. Теперь каждый,
 * кто зовёт модель, импортирует этот модуль явно.
 *
 * ВАЖНО: `.env` должен быть загружен до импорта — env читается здесь, на загрузке.
 * В CLI и скриптах это делает `import 'dotenv/config'` первой строкой, в приложении — Next.
 */

import OpenAI from 'openai';
import { setDefaultOpenAIClient, setOpenAIAPI, setTracingDisabled } from '@openai/agents';

const apiKey = process.env.DEEPSEEK_API_KEY;
if (!apiKey) throw new Error('Нет DEEPSEEK_API_KEY в .env (см. .env.example)');

setDefaultOpenAIClient(new OpenAI({ baseURL: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com', apiKey }));
setOpenAIAPI('chat_completions'); // DeepSeek говорит на /chat/completions, не на Responses API
setTracingDisabled(true);

/** Модель прогона: коуч, ревьюер и шаг фиксации. Роутер берёт свою — см. `src/os/router.ts`. */
export const MODEL = process.env.DEEPSEEK_MODEL ?? 'deepseek-v4-pro';

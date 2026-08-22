/**
 * Заливка активных промптов в Langfuse Prompt Management (`docs/specB.md`).
 *
 *   npm run prompts:push          — залить activные версии под label production
 *   npm run prompts:push -- --dry — показать, что уехало бы, не трогая сеть
 *
 * Инструмент отладки, а не часть продукта: harness он не импортирует и агентов не зовёт —
 * той же логикой, что `ingest`, `replay` и `mcpInspect` (`docs/spec5.md`). Скрипт односторонний
 * и намеренно: обратной выгрузки «из Langfuse в файлы» здесь нет. Файлы — исходник и fallback,
 * платформа — место, где промпт правят между деплоями; синхронизировать их в обе стороны
 * значило бы получить два источника правды и вопрос «чья версия свежее».
 *
 * Каждый запуск создаёт **новую версию** промпта в Langfuse и вешает на неё label. Это не
 * идемпотентность `ingest`, и так и задумано: версии — это история промпта, затирать её нечем.
 */

import 'dotenv/config'; // первым: клиент Langfuse читает env
import { ACTIVE_PROMPTS, loadActivePrompt, promptName, type PromptRole } from '../src/harness/promptVersions';
import { isLangfuseEnabled, langfuseClient } from '../src/langfuse/client';

const LABEL = process.env.LANGFUSE_PROMPT_LABEL?.trim() || 'production';

const ROLES = Object.keys(ACTIVE_PROMPTS) as PromptRole[];

async function main(): Promise<number> {
  const dry = process.argv.includes('--dry');

  const prompts = ROLES.map((role) => ({
    role,
    name: promptName(role),
    version: ACTIVE_PROMPTS[role],
    text: loadActivePrompt(role),
  }));

  console.log(`Промптов: ${prompts.length}, label: ${LABEL}${dry ? ' (--dry: без сети)' : ''}\n`);
  for (const { role, name, version, text } of prompts) {
    console.log(`${role}: ${name} ← prompts/${name}.${version}.md (${text.length} символов)`);
  }

  if (dry) {
    console.log('\n--dry: ничего не отправлено.');
    return 0;
  }

  if (!isLangfuseEnabled()) {
    console.error('\nНет LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY в .env — заливать некуда.');
    return 1;
  }

  const client = langfuseClient()!;
  console.log('');
  for (const { name, version, text } of prompts) {
    // Без try/catch намеренно: здесь, в отличие от прогона, сбой отправки — это и есть
    // результат работы скрипта. Молча отрапортовать об успехе было бы хуже, чем упасть.
    const created = await client.prompt.create({
      name,
      prompt: text,
      type: 'text',
      labels: [LABEL],
      commitMessage: `из prompts/${name}.${version}.md`,
    });
    console.log(`✓ ${name} → версия ${created.version}, label ${LABEL}`);
  }

  console.log('\nГотово. Следующий прогон возьмёт промпты отсюда — пересборка не нужна.');
  return 0;
}

process.exitCode = await main().catch((err: unknown) => {
  console.error(`Ошибка: ${err instanceof Error ? err.message : String(err)}`);
  return 1;
});

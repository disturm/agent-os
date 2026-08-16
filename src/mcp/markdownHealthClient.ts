/**
 * Подключение к своему MCP-серверу со стороны агента.
 *
 * Единственное место, где написано, как поднимается серверный процесс: остальным достаточно
 * знать, что `startMarkdownHealthServer()` возвращает подключённый сервер, а `selectMcpTools()`
 * отдаёт с него инструменты по именам. Кому какие имена достанутся — решает harness, это
 * раздача прав, а не свойство подключения (см. `runHealthAgent.ts`).
 *
 * Сервер — отдельный процесс на stdio: harness поднимает его на прогон и гасит в `finally`.
 * Сетевых транспортов и чужих серверов в проекте нет и не должно быть (`docs/spec6.md`).
 */

import { join } from 'node:path';
import { getAllMcpTools, MCPServerStdio, type Tool } from '@openai/agents';

/** Точка входа сервера. Путь относительный: `cwd` дочернего процесса — корень проекта. */
const SERVER_ENTRY = join('src', 'mcp', 'markdownHealthServer.ts');

/**
 * Запускает сервер и дожидается рукопожатия MCP.
 *
 * Запуск идёт через `process.execPath --import tsx`, а не через `npx tsx`: сервер написан
 * на TypeScript и собирать его отдельно незачем, а `npx` на Windows — это `.cmd`-обёртка,
 * спавн которой ломается. `process.execPath` — тот же node, что крутит приложение.
 *
 * Зовётся до первого обращения к модели: если сервер не поднялся, прогон должен упасть
 * бесплатно, а не после оплаченных вызовов.
 */
export async function startMarkdownHealthServer(): Promise<MCPServerStdio> {
  const server = new MCPServerStdio({
    name: 'markdown-health',
    command: process.execPath,
    args: ['--import', 'tsx', SERVER_ENTRY],
    cwd: process.cwd(), // `data/` и `prompts/` читаются от корня проекта — дочерний процесс должен стоять там же
    cacheToolsList: true, // список инструментов за прогон не меняется
  });
  await server.connect();
  return server;
}

/**
 * Инструменты сервера по именам — в том виде, в каком их принимает `Agent`.
 *
 * MCP-инструмент после конвертации ничем не отличается от локального `tool()`: то же имя,
 * та же схема параметров, тот же след в `toolCalls`. Ради этого spec6 и затевался.
 *
 * Неизвестное имя — это опечатка или переименование на сервере, и молча отдать агенту
 * набор короче запрошенного нельзя: он пойдёт сочинять данные вместо вызова. Падаем сразу.
 */
export async function selectMcpTools(server: MCPServerStdio, names: string[]): Promise<Tool[]> {
  const available = await getAllMcpTools([server]);
  return names.map((name) => {
    const found = available.find((tool) => tool.name === name);
    if (!found) {
      throw new Error(
        `MCP-сервер ${server.name} не отдаёт инструмент ${name}. Есть: ${available.map((t) => t.name).join(', ')}`,
      );
    }
    return found;
  });
}

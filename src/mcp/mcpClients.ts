/**
 * Подключение к MCP-серверам из `servers.config.ts` со стороны приложения.
 *
 * Единственное место, где серверы спавнятся и гасятся. Что подключено — решает конфиг,
 * кому какой набор инструментов достанется — тоже он; здесь только исполнение: поднять
 * включённые, собрать инструменты в два плоских списка и запомнить, с какого сервера
 * пришло какое имя.
 *
 * Ради этого модуля harness не знает ни про `npx`, ни про stdio, ни про число серверов:
 * он видит `draftTools`, `approvedTools` и `close()`. Поэтому новая запись в конфиге
 * не требует правок harness — это и есть требование `docs/spec7.md`.
 *
 * Сетевых транспортов (SSE, streamable HTTP) в проекте нет: только stdio и только
 * локальные процессы.
 */

import { getAllMcpTools, MCPServerStdio, type Tool } from '@openai/agents';
import { MCP_SERVERS, type McpServerConfig } from './servers.config';

/**
 * Сколько ждать рукопожатия MCP. Дефолт SDK — 5 секунд, и его не хватает: `npx -y <пакет>`
 * на холодном кэше сначала скачивает пакет, и первый запуск занимает десятки секунд.
 * Прогретый кэш укладывается в доли секунды, так что на обычный прогон запас не влияет.
 */
const CONNECT_TIMEOUT_SECONDS = 90;

/** Имя инструмента → имя сервера, который его отдал. Всё, чего нет в карте, — локальный `tool()`. */
export type ToolSources = ReadonlyMap<string, string>;

export type McpConnections = {
  /** Инструменты черновых кругов: со всех поднятых серверов, одним списком. */
  draftTools: Tool[];
  /** Инструменты, выдаваемые после `approve`. Всё необратимое — только здесь. */
  approvedTools: Tool[];
  sources: ToolSources;
  /** Имена поднятых серверов в порядке конфига — для лога прогона. */
  started: string[];
  close(): Promise<void>;
};

/**
 * Работает ли сервер в этом прогоне.
 *
 * `enabled: true` — да. `enabled: false` — только если названная в `enabledWhenEnv`
 * переменная окружения непустая: так Notion включается сам от одного `NOTION_TOKEN` в `.env`.
 * Ни одно из условий не выполнено — сервер просто отсутствует, без предупреждений:
 * выключенная интеграция это нормальное состояние, а не сбой.
 */
export function isEnabled(config: McpServerConfig): boolean {
  if (config.enabled) return true;
  return Boolean(config.enabledWhenEnv && process.env[config.enabledWhenEnv]?.trim());
}

export function enabledServers(configs: McpServerConfig[] = MCP_SERVERS): McpServerConfig[] {
  return configs.filter(isEnabled);
}

/**
 * Поднимает один сервер и дожидается рукопожатия.
 *
 * `cwd` — корень проекта: и наш сервер (читает `data/`), и filesystem (разворачивает
 * относительные `data`/`plans` в свои allowed directories) считают пути от него.
 *
 * `env` из конфига дописывается к безопасному минимуму, который MCP SDK пробрасывает сам
 * (PATH, TEMP и прочее) — иначе `npx` не нашёлся бы. Пустые значения выбрасываются:
 * `NOTION_TOKEN=undefined` в окружении хуже, чем его отсутствие.
 */
export async function startServer(config: McpServerConfig): Promise<MCPServerStdio> {
  const env = Object.fromEntries(
    Object.entries(config.env ?? {}).filter((entry): entry is [string, string] => Boolean(entry[1])),
  );
  const server = new MCPServerStdio({
    name: config.name,
    command: config.command,
    args: config.args,
    ...(Object.keys(env).length ? { env } : {}),
    cwd: process.cwd(),
    cacheToolsList: true, // список инструментов за прогон не меняется
    clientSessionTimeoutSeconds: CONNECT_TIMEOUT_SECONDS,
  });
  await server.connect();
  return server;
}

/**
 * Имя инструмента так, как его увидит модель.
 *
 * SDK прогоняет имена MCP-инструментов через `toFunctionToolName`: любой символ, кроме
 * букв и цифр, заменяется на `_`. Своих серверов это не касается — у нас имена и так
 * `read_profile`, — а вот Notion публикует `API-post-search`, и до агента он доходит как
 * `API_post_search`. Именно конвертированное имя попадает в `toolCalls` и в трейс.
 *
 * Сравниваем по этой форме, поэтому в конфиге допустимы обе записи. `mcp:inspect` печатает
 * сырое имя сервера — по нему нельзя было бы вслепую заполнить `draftTools`.
 */
function toolNameKey(name: string): string {
  return name.replace(/[^a-zA-Z0-9]/g, '_');
}

/**
 * Инструменты сервера по именам — в том виде, в каком их принимает `Agent`.
 *
 * MCP-инструмент после конвертации ничем не отличается от локального `tool()`: то же имя,
 * та же схема параметров, тот же след в `toolCalls`.
 *
 * Неизвестное имя — это опечатка в конфиге или переименование на стороне сервера, и молча
 * отдать агенту набор короче запрошенного нельзя: он пойдёт сочинять данные вместо вызова.
 * Падаем сразу, до платных вызовов модели.
 */
export function selectMcpTools(available: Tool[], names: string[], serverName: string): Tool[] {
  return names.map((name) => {
    const key = toolNameKey(name);
    const found = available.find((tool) => toolNameKey(tool.name) === key);
    if (!found) {
      throw new Error(
        `MCP-сервер ${serverName} не отдаёт инструмент ${name}. Есть: ${available.map((t) => t.name).join(', ')}`,
      );
    }
    return found;
  });
}

/**
 * Поднимает все включённые серверы и собирает их инструменты в два набора.
 *
 * Сбой любого сервера роняет прогон, а уже поднятые процессы гасятся: набор короче
 * ожидаемого — это молчаливая потеря источника данных, а не деградация. Зовётся до первого
 * обращения к модели, поэтому падение обходится бесплатно.
 */
export async function startConfiguredServers(configs: McpServerConfig[] = MCP_SERVERS): Promise<McpConnections> {
  const running: MCPServerStdio[] = [];
  const closeAll = async () => {
    await Promise.allSettled(running.map((server) => server.close()));
  };

  try {
    const draftTools: Tool[] = [];
    const approvedTools: Tool[] = [];
    const sources = new Map<string, string>();
    const started: string[] = [];

    for (const config of enabledServers(configs)) {
      const server = await startServer(config);
      running.push(server);
      started.push(config.name);

      // Карта источников строится по полному списку сервера, а не по выданным наборам:
      // пометить в трейсе надо любой вызов, включая тот, которого мы не ожидали.
      const available = await getAllMcpTools([server]);
      for (const tool of available) sources.set(tool.name, config.name);

      draftTools.push(...selectMcpTools(available, config.draftTools ?? [], config.name));
      approvedTools.push(...selectMcpTools(available, config.approvedTools ?? [], config.name));
    }

    return { draftTools, approvedTools, sources, started, close: closeAll };
  } catch (err) {
    await closeAll();
    throw err;
  }
}

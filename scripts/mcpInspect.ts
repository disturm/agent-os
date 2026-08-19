/**
 * Инспектор MCP-серверов из `src/mcp/servers.config.ts`: поднять включённые, спросить,
 * что они умеют, погасить.
 *
 *   npm run mcp:inspect
 *
 * Смысл — увидеть серверы глазами клиента, не запуская агента: те же `tools/list` и
 * `resources/list`, которые при обычном прогоне выполняет OpenAI Agents SDK. По спискам
 * видно и то, чего агенту не дают: `append_daily_log` наш сервер публикует, а в набор
 * коуча он не попадает; у filesystem инструментов четырнадцать, а выдаётся один.
 * Пропущенные серверы печатаются отдельным блоком с причиной — в прогоне их не видно вовсе.
 *
 * Прогон бесплатный: модель здесь не вызывается, ключ DeepSeek не нужен — поэтому
 * `dotenv` не подключается, а harness не импортируется (он требует ключ при загрузке).
 * Из-за этого `NOTION_TOKEN` из `.env` тут не виден: чтобы проверить Notion, задайте
 * переменную в окружении команды.
 */

import { isEnabled, startServer } from '../src/mcp/mcpClients';
import { MCP_SERVERS, type McpServerConfig } from '../src/mcp/servers.config';

/**
 * Параметры инструмента из JSON Schema: `latitude: number, longitude: number, +21`.
 *
 * Печатаются только обязательные, остальные считаются хвостом: у чужих серверов
 * необязательных параметров бывает по два десятка, и строка перестаёт читаться.
 */
function paramsOf(schema: unknown): string {
  if (!schema || typeof schema !== 'object') return '';
  const { properties, required } = schema as { properties?: Record<string, { type?: string }>; required?: string[] };
  const names = Object.keys(properties ?? {});
  if (!names.length) return '';
  const req = names.filter((name) => required?.includes(name));
  const rest = names.length - req.length;
  return [...req.map((name) => `${name}: ${properties?.[name]?.type ?? '?'}`), ...(rest ? [`+${rest}`] : [])].join(', ');
}

/**
 * Первая фраза описания: полные описания инструментов длинные, в таблицу они не влезают.
 * Переводы строк схлопываются — у Notion в описании идёт список кодов ошибок, и без этого
 * таблица разъезжается на десяток строк.
 */
function firstSentence(text: string | undefined): string {
  if (!text) return '—';
  const flat = text.replace(/\s+/g, ' ').trim();
  const cut = flat.indexOf('. ');
  return cut === -1 ? flat : flat.slice(0, cut + 1);
}

function printSection(title: string, rows: [string, string][]): void {
  console.log(`\n  --- ${title} (${rows.length}) ---\n`);
  if (!rows.length) return;
  const width = Math.max(...rows.map(([left]) => left.length));
  for (const [left, right] of rows) console.log(`    ${left.padEnd(width)}  ${right}`);
}

/**
 * Имя инструмента так, как его увидит модель: SDK заменяет всё, кроме букв и цифр, на `_`.
 * Notion публикует `API-post-search`, агент вызывает `API_post_search` — и в конфиге,
 * и в `toolCalls` живёт вторая форма (см. `mcpClients.ts`).
 */
function toolNameKey(name: string): string {
  return name.replace(/[^a-zA-Z0-9]/g, '_');
}

/** Что из набора сервера реально достанется агенту — и в какой фазе прогона. */
function grantOf(config: McpServerConfig, name: string): string {
  const key = toolNameKey(name);
  const has = (names?: string[]) => names?.some((candidate) => toolNameKey(candidate) === key);
  if (has(config.draftTools)) return '→ коучу';
  if (has(config.approvedTools)) return '→ после approve';
  return '';
}

async function inspect(config: McpServerConfig): Promise<void> {
  console.log(`\n=== ${config.name} === (${config.command === process.execPath ? 'node' : config.command} ${config.args.join(' ')})`);
  const server = await startServer(config);
  try {
    const tools = await server.listTools();
    printSection(
      'Tools',
      tools.map((tool) => {
        const grant = grantOf(config, tool.name);
        // Имя сервера и имя для агента расходятся у Notion — показываем второе, писать в конфиг надо его
        const asAgentSees = toolNameKey(tool.name);
        const shown = asAgentSees === tool.name ? tool.name : `${tool.name} → ${asAgentSees}`;
        return [`${shown}(${paramsOf(tool.inputSchema)})`, `${grant ? `${grant}  ` : ''}${firstSentence(tool.description)}`] as [string, string];
      }),
    );

    // Ресурсы есть не у всех: capability необязательна, и чужие серверы обычно ограничиваются tools.
    try {
      const { resources } = await server.listResources();
      printSection('Resources', resources.map((r) => [r.uri, r.description ?? r.name ?? '—'] as [string, string]));
    } catch {
      console.log('\n  --- Resources: сервер их не публикует ---');
    }
  } finally {
    await server.close();
  }
}

async function main(): Promise<void> {
  const enabled = MCP_SERVERS.filter(isEnabled);
  const skipped = MCP_SERVERS.filter((config) => !isEnabled(config));

  console.log(`Серверов в конфиге: ${MCP_SERVERS.length}, поднимаю ${enabled.length} (stdio, отдельный процесс на каждый)…`);
  for (const config of enabled) await inspect(config);

  if (skipped.length) {
    console.log('\n=== Пропущены ===\n');
    for (const config of skipped) {
      const reason = config.enabledWhenEnv ? `enabled: false, нет ${config.enabledWhenEnv}` : 'enabled: false';
      console.log(`  ${config.name.padEnd(16)} ${reason}`);
    }
  }

  console.log('\nАгенту из этих наборов достаются не все инструменты: право на вызов раздаёт harness по конфигу.');
  console.log('Пометка «→ коучу» — потолок, а не факт: модуль OS сужает набор ещё раз (src/os/modules/).');
}

process.exitCode = await main().then(
  () => 0,
  (err: unknown) => {
    console.error(`Ошибка: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  },
);

/**
 * Инспектор своего MCP-сервера: поднять, спросить, что он умеет, погасить.
 *
 *   npm run mcp:inspect
 *
 * Смысл — увидеть сервер глазами клиента, не запуская агента: те же `tools/list` и
 * `resources/list`, которые при обычном прогоне выполняет OpenAI Agents SDK. По списку
 * видно и то, чего агенту не дают: `append_daily_log` сервер публикует, а в набор коуча
 * он не попадает — право на вызов раздаёт harness (см. `runHealthAgent.ts`).
 *
 * Прогон бесплатный: модель здесь не вызывается, ключ DeepSeek не нужен — поэтому
 * `dotenv` не подключается, а harness не импортируется (он требует ключ при загрузке).
 */

import { startMarkdownHealthServer } from '../src/mcp/markdownHealthClient';

/** Параметры инструмента из JSON Schema: `days: number*`, звёздочка — обязательный. */
function paramsOf(schema: unknown): string {
  if (!schema || typeof schema !== 'object') return '';
  const { properties, required } = schema as { properties?: Record<string, { type?: string }>; required?: string[] };
  const names = Object.keys(properties ?? {});
  if (!names.length) return '';
  return names.map((name) => `${name}: ${properties?.[name]?.type ?? '?'}${required?.includes(name) ? '*' : ''}`).join(', ');
}

/** Первая фраза описания: полные описания инструментов длинные, в таблицу они не влезают. */
function firstSentence(text: string | undefined): string {
  if (!text) return '—';
  const cut = text.indexOf('. ');
  return cut === -1 ? text : text.slice(0, cut + 1);
}

function printSection(title: string, rows: [string, string][]): void {
  console.log(`\n=== ${title} (${rows.length}) ===\n`);
  const width = Math.max(...rows.map(([left]) => left.length));
  for (const [left, right] of rows) console.log(`  ${left.padEnd(width)}  ${right}`);
}

async function main(): Promise<void> {
  console.log('Поднимаю MCP-сервер markdown-health (stdio, отдельный процесс)…');
  const server = await startMarkdownHealthServer();

  try {
    const tools = await server.listTools();
    printSection(
      'Tools',
      tools.map((tool) => {
        const params = paramsOf(tool.inputSchema);
        return [`${tool.name}(${params})`, firstSentence(tool.description)] as [string, string];
      }),
    );

    const { resources } = await server.listResources();
    printSection('Resources', resources.map((r) => [r.uri, r.description ?? r.name ?? '—'] as [string, string]));

    console.log('\nАгенту из этого набора достаются не все инструменты: право на вызов раздаёт harness.');
  } finally {
    await server.close();
  }
}

process.exitCode = await main().then(
  () => 0,
  (err: unknown) => {
    console.error(`Ошибка: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  },
);

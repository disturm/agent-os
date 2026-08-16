/**
 * Имена инструментов, вызванных агентом за один прогон `run()`, с пометкой источника.
 *
 * Инструменты у агента появились, а видимости — нет: снаружи прогон по-прежнему выглядит
 * как «пришёл текст плана». Модуль превращает элементы прогона в плоский список строк,
 * по которому видно и что агент делал, и чем именно. Ничего не решает и никуда не пишет —
 * порядок и накопление остаются за оркестратором.
 *
 * Про MCP модуль не знает: карта источников приходит параметром как обычный `ReadonlyMap`
 * (её строит `src/mcp/mcpClients.ts`). Так же, как `traceRun.ts` не импортирует оркестратор.
 */

import type { RunItem } from '@openai/agents';

/** Источник инструмента, которого нет в карте MCP-серверов: локальный `tool()` из `src/skills/`. */
export const LOCAL_SOURCE = 'local';

/** `[weather] weather_forecast` — источник виден и в логе прогона, и в трейсе, и в UI. */
export function formatToolCall(source: string, name: string): string {
  return `[${source}] ${name}`;
}

/**
 * Был ли вызван инструмент с таким именем. Источник не важен: проверяется факт вызова,
 * а с какого сервера пришёл инструмент — дело конфига, и harness об этом знать не должен.
 */
export function calledTool(entries: string[], name: string): boolean {
  return entries.some((entry) => entry.endsWith(`] ${name}`));
}

/**
 * Вызовы в порядке появления. Повторы не схлопываются: два `read_profile` — два факта.
 *
 * Источник — это имя сервера из конфига (`markdown-health`, `filesystem`, `weather`,
 * `notion`) либо `local`. Пометка нужна человеку: для агента MCP-инструмент и локальный
 * `tool()` неразличимы — одно имя, одна схема параметров, один вызов, — а вот в разборе
 * прогона разница между «прочитал свой markdown» и «сходил в чужой сервер» существенна.
 *
 * Незнакомое имя считается локальным, а не отбрасывается: набор инструментов агента —
 * это MCP-серверы плюс `src/skills/`, и всё, чего нет в карте, приходит из вторых.
 */
export function toolCallNames(items: RunItem[], sources: ReadonlyMap<string, string>): string[] {
  return items
    .filter((item) => item.type === 'tool_call_item')
    // У функциональных вызовов есть имя; у остальных типов (computer use и прочее,
    // которых у нас нет) остаётся хотя бы тип — молча терять вызов нельзя.
    .map((item) => ('name' in item.rawItem ? item.rawItem.name : item.rawItem.type))
    .map((name) => formatToolCall(sources.get(name) ?? LOCAL_SOURCE, name));
}

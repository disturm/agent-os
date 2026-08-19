/**
 * Обновление памяти после одобренного прогона (`docs/specA.md`).
 *
 * Два действия, оба через MCP и оба — кодом, а не моделью:
 *   1. `append_daily_log` — короткая запись в дневник: дата, тип запроса, суть плана;
 *   2. `update_preferences` — подтверждённое предпочтение, но только если пользователь
 *      попросил об этом явно («мне понравилось», «запомни»).
 *
 * Почему не агентом. Инструкция «запиши в дневник» в промпте — просьба: модель может её
 * пропустить, а может выполнить лишний раз и записать зарубленный черновик. Здесь же нужен
 * ровно один детерминированный факт после ровно одного события (`approve`), и стоить он
 * должен ноль вызовов модели. Поэтому `append_daily_log` и `update_preferences` не входят
 * ни в один набор агента и зовутся напрямую (`callTool`), пока серверы ещё подняты.
 *
 * Никакой второй модели для «суммаризации плана» тут нет и не нужно: суть берётся из
 * заголовка «Цель дня», который коуч и так обязан написать.
 */

import type { McpCallTool } from '../mcp/mcpClients';

/** Сервер, на котором живут дневник и предпочтения. */
const MEMORY_SERVER = 'markdown-health';

/** Сколько символов сути плана уезжает в дневник. Дневник — не архив планов, план лежит в трейсе. */
const GIST_LIMIT = 200;

/**
 * Явный сигнал «запомни это».
 *
 * Список короткий и намеренно буквальный: предпочтение записывается только тогда, когда
 * человек сам об этом попросил. Угадывать предпочтения по тексту плана нельзя — так в память
 * попадёт то, чего он не говорил, и вычищать это придётся руками.
 *
 * ВАЖНО: `\b` здесь не используется. В JavaScript граница слова определена через `\w`,
 * то есть `[A-Za-z0-9_]`, и с кириллицей она не срабатывает вовсе: `/\bзапомни\b/` не
 * находит «запомни» ни в одной строке. Поэтому корни пишутся без границ, а окончания —
 * открытыми: «запомни», «запомните» и «запомнить» — один и тот же сигнал.
 */
const PREFERENCE_SIGNALS = [
  /запомни/i,
  /запиши\s+(?:в\s+)?предпочтени/i,
  /понравил/i,
  /(?:мне|нам)\s+зашл[оа]/i,
  /учти\s+на\s+будущее/i,
  /больше\s+(?:так\s+)?не\s+предлагай/i,
  /не\s+предлагай\s+больше/i,
];

/** Просил ли пользователь что-то запомнить. Разбор текста задачи, без вызовов модели. */
export function hasPreferenceSignal(task: string): boolean {
  return PREFERENCE_SIGNALS.some((signal) => signal.test(task));
}

/**
 * Суть плана одной строкой: первая содержательная строка раздела «Цель дня».
 *
 * Раздел выбран не случайно — он есть в каждом плане по требованию промпта коуча и
 * отвечает ровно на вопрос «о чём был этот план». Раздела нет (модель отступила от формата) —
 * берём первую строку плана, которая не заголовок и не пустая.
 */
export function planGist(plan: string): string {
  const lines = plan.split('\n').map((line) => line.trim());
  const goalAt = lines.findIndex((line) => /^#{1,3}\s*Цель дня/i.test(line));
  const from = goalAt === -1 ? 0 : goalAt + 1;

  const gist = lines
    .slice(from)
    .find((line) => line.length > 0 && !line.startsWith('#'))
    ?.replace(/^[-*]\s*/, '')
    .trim();

  if (!gist) return 'план без раздела «Цель дня»';
  return gist.length > GIST_LIMIT ? `${gist.slice(0, GIST_LIMIT)}…` : gist;
}

/** Задача одной строкой: в дневнике она стоит в кавычках, переносы там ни к чему. */
function oneLine(task: string): string {
  return task.trim().replace(/\s+/g, ' ');
}

/**
 * Запись в дневник. Заголовок дня ставит сам `append_daily_log` — здесь только тело,
 * иначе формат даты пришлось бы держать в двух местах.
 */
export function dailyLogEntry(task: string, plan: string, module: string): string {
  return [
    `- Запрос (модуль ${module}): «${oneLine(task)}»`,
    `- План: ${planGist(plan)}`,
    '- Запись сделана автоматически после одобрения плана.',
  ].join('\n');
}

export type MemoryUpdate = {
  task: string;
  plan: string;
  module: string;
  callTool: McpCallTool;
};

/**
 * Обновляет память после `approve`.
 *
 * Дневник дописывается всегда, предпочтения — только по явному сигналу. Исключений здесь
 * не ловим намеренно: их ловит harness (`afterApprove`), и там же решено, что сбой этого
 * шага прогон не роняет. Дублировать try/catch на два уровня значило бы прятать причину.
 */
export async function updateMemory({ task, plan, module, callTool }: MemoryUpdate): Promise<void> {
  const logged = await callTool(MEMORY_SERVER, 'append_daily_log', {
    entry: dailyLogEntry(task, plan, module),
  });
  console.log(`  память: дневник — ${logged}`);

  if (!hasPreferenceSignal(task)) return;
  const saved = await callTool(MEMORY_SERVER, 'update_preferences', { preference: oneLine(task) });
  console.log(`  память: предпочтения — ${saved}`);
}

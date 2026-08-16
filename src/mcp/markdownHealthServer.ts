/**
 * MCP-сервер поверх markdown-файлов из `data/`. Точка входа отдельного процесса —
 * импортировать этот файл неоткуда не надо, его запускают по записи в `servers.config.ts`
 * (см. `mcpClients.ts`).
 *
 * Здесь только протокол: регистрация инструментов и ресурсов плюс подключение stdio-транспорта.
 * Сами файлы читает и пишет `markdownData.ts` — сервер не знает ни про пути, ни про формат
 * дневника, а модуль данных не знает про MCP.
 *
 * Что отдаётся наружу:
 *   tools     read_profile, read_recent_logs(days), append_daily_log(entry),
 *             save_health_plan(markdown), list_recipes
 *   resources profile://me, logs://recent, recipes://all, plans://latest
 *
 * Набор инструментов сервера и набор инструментов агента — разные вещи: право на вызов
 * раздаёт harness (`runHealthAgent.ts`), поэтому, например, `append_daily_log` сервер
 * публикует, а коучу его никто не даёт — дневник это ручные данные пользователя.
 *
 * ВАЖНО: `stdout` занят протоколом JSON-RPC. Любая диагностика — только в `stderr`
 * (`console.error`), иначе клиент получит мусор вместо ответа.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  appendDailyLog,
  readLatestPlan,
  readProfile,
  readRecentLog,
  readRecipes,
  RECENT_LOG_DAYS,
  saveHealthPlan,
} from './markdownData';

const MARKDOWN = 'text/markdown';

/** Ответ инструмента: у нас всё текстовое, оборачивать одинаково. */
const text = (value: string) => ({ content: [{ type: 'text' as const, text: value }] });

const server = new McpServer(
  { name: 'markdown-health', version: '1.0.0' },
  { capabilities: { tools: {}, resources: {} } },
);

// --- Tools ---

server.registerTool(
  'read_profile',
  {
    title: 'Профиль пользователя',
    description: [
      'Возвращает профиль пользователя как markdown: возраст, рост и вес, город, характер работы,',
      'цели, ограничения (травмы, аллергии, пищевые непереносимости), предпочтения в еде и тренировках,',
      'текущие привычки.',
      'Здесь же берётся локация для прогноза погоды: города в профиле нет — его неоткуда взять.',
      'Вызывай ПЕРВЫМ в любой задаче про питание, тренировки, режим дня или покупки:',
      'без ограничений из профиля план может оказаться опасным (аллергия, травма) или невыполнимым.',
      'Параметров нет, данные за прогон не меняются — второй раз вызывать незачем.',
    ].join(' '),
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  async () => text(readProfile()),
);

server.registerTool(
  'read_recent_logs',
  {
    title: 'Дневник за последние дни',
    description: [
      'Возвращает последние записи из дневника пользователя как markdown: по дню на раздел —',
      'что ел, сколько пил воды, как спал, была ли тренировка, самочувствие.',
      'Вызывай, когда задача касается текущего состояния, привычек, нагрузки или содержит слова',
      'вроде «с учётом моего лога», «за последние дни», «как я спал».',
      'Профиль это не заменяет: в дневнике нет целей и ограничений.',
      'Записей в файле может быть меньше, чем запрошено, — тогда вернутся все, что есть.',
    ].join(' '),
    inputSchema: {
      days: z
        .number()
        .int()
        .min(1)
        .max(30)
        .describe('Сколько последних дней вернуть. Разумный запрос — 3–7 дней; больше 7 нужно редко.'),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ days }) => text(readRecentLog(days)),
);

server.registerTool(
  'list_recipes',
  {
    title: 'Любимые рецепты',
    description: [
      'Возвращает список блюд, которые пользователь уже готовит: время приготовления, продукты,',
      'краткий способ и теги (завтрак, ужин, белок, быстро).',
      'Вызывай, когда планируешь еду: знакомое блюдо человек приготовит охотнее нового.',
      'Ограничения по продуктам всё равно проверяй по read_profile — список рецептов их не дублирует.',
      'Параметров нет, файл за прогон не меняется.',
    ].join(' '),
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  async () => text(readRecipes()),
);

server.registerTool(
  'save_health_plan',
  {
    title: 'Сохранить итоговый план',
    description: [
      'Сохраняет итоговый план в data/output.md, перезаписывая прежний.',
      'Вызывай только тогда, когда план уже одобрен ревьюером и его просят зафиксировать:',
      'это точка невозврата, черновики и промежуточные версии сюда не пишут.',
      'Передавай план целиком и без изменений — файл станет ровно тем, что ты передал.',
      'Возвращает ok и число сохранённых символов.',
    ].join(' '),
    inputSchema: {
      markdown: z
        .string()
        .min(1)
        .describe('Полный текст плана в markdown, вместе с заголовками разделов. Не сокращать и не пересказывать.'),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  },
  async ({ markdown }) => text(saveHealthPlan(markdown)),
);

server.registerTool(
  'append_daily_log',
  {
    title: 'Дописать запись в дневник',
    description: [
      'Дописывает запись в конец data/log.md новым разделом за сегодняшний день.',
      'Прежние записи не трогает: дневник ведёт человек, затирать его нельзя.',
      'Если в тексте уже есть заголовок «## <дата>», он сохраняется как есть.',
      'Возвращает ok и число записанных символов.',
    ].join(' '),
    inputSchema: {
      entry: z
        .string()
        .min(1)
        .describe('Текст записи в markdown: еда, вода, сон, тренировка, самочувствие — пунктами списка.'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  async ({ entry }) => text(appendDailyLog(entry)),
);

// --- Resources ---
// Вторая половина протокола: те же данные, но адресуемые по URI и без вызова инструмента.
// Агенту через OpenAI Agents SDK достаются только tools — ресурсы видны в `npm run mcp:inspect`
// и любому стандартному MCP-клиенту.

const resource = (uri: string, title: string, description: string, read: () => string) =>
  server.registerResource(title, uri, { title, description, mimeType: MARKDOWN }, async (url) => ({
    contents: [{ uri: url.href, mimeType: MARKDOWN, text: read() }],
  }));

resource('profile://me', 'Профиль', 'Цели, ограничения и предпочтения пользователя (data/profile.md)', readProfile);
resource(
  'logs://recent',
  'Дневник',
  `Последние ${RECENT_LOG_DAYS} дней из data/log.md: еда, вода, сон, тренировки`,
  () => readRecentLog(RECENT_LOG_DAYS),
);
resource('recipes://all', 'Рецепты', 'Блюда, которые пользователь уже готовит (data/recipes.md)', readRecipes);
resource('plans://latest', 'Последний план', 'Последний одобренный план (data/output.md)', readLatestPlan);

await server.connect(new StdioServerTransport());
console.error('markdown-health MCP: готов, транспорт stdio');

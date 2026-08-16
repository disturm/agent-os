/**
 * Доступ к markdown-файлам в `data/`: чтение профиля, дневника, рецептов и последнего плана,
 * запись плана и дописывание в дневник.
 *
 * Живёт отдельно от сервера, потому что одни и те же данные MCP отдаёт двумя способами —
 * инструментами (`tools`) и ресурсами (`resources`). Один источник на оба, иначе логика
 * нарезки дневника и путей к файлам разъедется по двум местам.
 *
 * Про MCP модуль не знает: на входе аргументы, на выходе строки. Ровно так же он выглядел,
 * когда был четырьмя навыками в `src/skills/` (до `docs/spec6.md`) — переезд в MCP сменил
 * транспорт, а не смысл.
 *
 * Пути считаются от `process.cwd()`, то есть от корня проекта: серверный процесс запускается
 * с тем же рабочим каталогом, что и приложение (см. `markdownHealthClient.ts`).
 */

import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dataFile = (name: string) => join(process.cwd(), 'data', name);

/** Сколько дней дневника отдаёт ресурс `logs://recent`: у ресурса нет параметров, глубину выбираем здесь. */
export const RECENT_LOG_DAYS = 7;

export function readProfile(): string {
  return readFileSync(dataFile('profile.md'), 'utf8');
}

export function readRecipes(): string {
  return readFileSync(dataFile('recipes.md'), 'utf8');
}

/** День в дневнике — раздел второго уровня (`## 14 августа, четверг`). Шапка файла в разделы не попадает. */
export function readRecentLog(days: number): string {
  const markdown = readFileSync(dataFile('log.md'), 'utf8');
  const entries = markdown.split(/\n(?=## )/).filter((chunk) => chunk.startsWith('## '));
  // Разметка непривычная — лучше отдать файл целиком, чем пустоту
  if (entries.length === 0) return markdown.trim();
  return entries.slice(-days).join('\n').trim();
}

/**
 * Последний одобренный план. Файла может не быть: `data/output.md` появляется только после
 * первого `approve`, а в `.gitignore` он есть — отсутствие это нормальное состояние,
 * а не ошибка чтения ресурса.
 */
export function readLatestPlan(): string {
  try {
    return readFileSync(dataFile('output.md'), 'utf8');
  } catch {
    return 'Плана пока нет: data/output.md появится после первого одобренного прогона.';
  }
}

export function saveHealthPlan(markdown: string): string {
  const text = `${markdown.trim()}\n`;
  writeFileSync(dataFile('output.md'), text, 'utf8');
  return `ok: план сохранён в data/output.md (${text.length} символов)`;
}

/** Заголовок дня в том же виде, в каком они уже лежат в файле: «14 августа, четверг». */
function todayHeading(): string {
  const now = new Date();
  const day = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(now);
  const weekday = new Intl.DateTimeFormat('ru-RU', { weekday: 'long' }).format(now);
  return `${day}, ${weekday}`;
}

/**
 * Дописывает запись в конец `data/log.md` новым разделом за сегодня.
 *
 * Дописывание, а не перезапись: дневник — ручные данные пользователя, и затирать их
 * инструмент не должен. Если запись уже пришла со своим заголовком `## `, он остаётся
 * как есть — значит, автор записи сам решил, каким днём её пометить.
 */
export function appendDailyLog(entry: string): string {
  const body = entry.trim();
  const section = body.startsWith('## ') ? body : `## ${todayHeading()}\n\n${body}`;
  appendFileSync(dataFile('log.md'), `\n${section}\n`, 'utf8');
  return `ok: запись добавлена в data/log.md (${body.length} символов)`;
}

/**
 * Доступ к markdown-файлам в `data/`: чтение профиля, дневника, рецептов, привычек и
 * последнего плана, запись плана, дописывание в дневник, отметка привычки и запись
 * подтверждённого предпочтения.
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
 * с тем же рабочим каталогом, что и приложение (см. `mcpClients.ts`).
 */

import { appendFileSync, copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dataFile = (name: string) => join(process.cwd(), 'data', name);

/**
 * Путь к файлу личной памяти, который ведёт не только человек.
 *
 * `data/log.md` и `data/preferences.md` дописывает шаг обновления памяти на каждый одобренный
 * прогон, поэтому в репозитории их нет — иначе `git status` пачкался бы от любого запуска,
 * а `npm run eval` добавлял бы туда по записи на кейс. Но и просто отсутствовать они не могут:
 * без дневника свежий клон не покажет ничего из того, ради чего личная память заводилась.
 *
 * Отсюда посев: в репозитории лежит `<имя>.example.md`, и при первом обращении он копируется
 * на место рабочего файла. Дальше файл живёт своей жизнью и правится руками — пример его
 * больше не трогает. Копирование, а не чтение примера напрямую: иначе после первой же записи
 * данные разъехались бы по двум файлам, и посевной дневник исчез бы из выдачи.
 */
function seededDataFile(name: string): string {
  const path = dataFile(name);
  if (!existsSync(path)) {
    const example = dataFile(name.replace(/\.md$/, '.example.md'));
    if (existsSync(example)) copyFileSync(example, path);
  }
  return path;
}

/** Сколько дней дневника отдаёт ресурс `logs://recent`: у ресурса нет параметров, глубину выбираем здесь. */
export const RECENT_LOG_DAYS = 7;

/**
 * Профиль вместе с подтверждёнными предпочтениями.
 *
 * Два файла склеиваются намеренно: `data/preferences.md` — это продолжение профиля, а не
 * отдельный источник. Заводить под него ещё один инструмент значило бы вписывать его в
 * набор каждого модуля OS и надеяться, что коуч вспомнит про вызов; так подтверждённое
 * предпочтение доезжает до него всегда и бесплатно, одним и тем же `read_profile`.
 *
 * Файла предпочтений может не быть: он появляется после первого сигнала пользователя
 * («запомни», «мне понравилось»), и его отсутствие — нормальное состояние.
 */
export function readProfile(): string {
  const profile = readFileSync(dataFile('profile.md'), 'utf8').trimEnd();
  const preferences = readPreferences();
  return preferences ? `${profile}\n\n${preferences}\n` : `${profile}\n`;
}

/**
 * Подтверждённые предпочтения как есть. Файл посевной (см. `seededDataFile`), но и без
 * примера отсутствие его не ошибка: предпочтений может просто не быть.
 */
export function readPreferences(): string {
  try {
    return readFileSync(seededDataFile('preferences.md'), 'utf8').trim();
  } catch {
    return '';
  }
}

export function readRecipes(): string {
  return readFileSync(dataFile('recipes.md'), 'utf8');
}

/** День в дневнике — раздел второго уровня (`## 14 августа, четверг`). Шапка файла в разделы не попадает. */
export function readRecentLog(days: number): string {
  const markdown = readFileSync(seededDataFile('log.md'), 'utf8');
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
  // Через seededDataFile, а не dataFile: appendFileSync создал бы пустой файл в обход посева,
  // и дневник-пример перестал бы попадать в выдачу после первой же записи.
  appendFileSync(seededDataFile('log.md'), `\n${section}\n`, 'utf8');
  return `ok: запись добавлена в data/log.md (${body.length} символов)`;
}

// --- Привычки (docs/specA.md) ---

/** Строка отметок внутри раздела привычки. Формат задан в `data/habits.md` и разбирается отсюда. */
const MARKS_LINE = /^(\s*-\s*Отметки:)(.*)$/m;

/**
 * Сегодня в том же виде, в каком отметки уже лежат в файле: `2026-08-19`.
 *
 * Дата локальная, а не `toISOString()`: тот отдаёт UTC, и в поясе восточнее Гринвича
 * ночная отметка уезжала бы вчерашним числом — при +3 всё с полуночи до трёх. Заголовок
 * дня в дневнике (`todayHeading`) считается по локальному времени, и расходиться с ним
 * этой дате нельзя: по ней же `check_habit` решает, отмечена ли привычка сегодня.
 */
function todayIso(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function readHabits(): string {
  try {
    return readFileSync(dataFile('habits.md'), 'utf8');
  } catch {
    return 'Трекера привычек нет: data/habits.md не заведён.';
  }
}

/** Заголовок раздела без решёток: `## Вода 2 литра в день` → `Вода 2 литра в день`. */
function headingOf(section: string): string {
  return section.slice(3).split('\n', 1)[0]!.trim();
}

/** Разделы файла привычек. Шапка (всё до первого `##`) в них не попадает — это пояснение для человека. */
function habitSections(markdown: string): string[] {
  return markdown.split(/\n(?=## )/).filter((chunk) => chunk.startsWith('## '));
}

/**
 * Отмечает привычку выполненной сегодня.
 *
 * Правки только дописывающие и идемпотентные: отметка за сегодня добавляется в строку
 * «Отметки:» нужного раздела, а если она там уже стоит — файл не трогается вовсе. Ни один
 * раздел не переписывается и не удаляется, поэтому инструмент безопасно давать на черновом
 * круге: он фиксирует факт, о котором сказал пользователь, а не результат ещё не одобренного
 * плана (см. `src/os/modules/habits.ts`).
 *
 * Новых привычек не заводит: неизвестное имя — это опечатка или привычка, которой в трекере
 * нет, и создавать её молча значило бы засорять файл пользователя. Вместо этого возвращается
 * список того, что в трекере есть.
 */
export function checkHabit(habit: string): string {
  const wanted = habit.trim().toLowerCase();
  const markdown = readFileSync(dataFile('habits.md'), 'utf8');
  const sections = habitSections(markdown);

  const section = sections.find((chunk) => {
    const heading = headingOf(chunk).toLowerCase();
    return heading === wanted || heading.includes(wanted) || wanted.includes(heading);
  });
  if (!section) {
    return `в трекере нет привычки «${habit.trim()}». Есть: ${sections.map(headingOf).join('; ') || '—'}`;
  }

  const heading = headingOf(section);
  const marks = section.match(MARKS_LINE);
  if (!marks) return `в разделе «${heading}» нет строки «- Отметки:» — отметить нечем`;

  const today = todayIso();
  const dates = marks[2]!
    .split(',')
    .map((date) => date.trim())
    .filter(Boolean);
  if (dates.includes(today)) return `ok: «${heading}» уже отмечена сегодня (${today})`;

  const updated = section.replace(MARKS_LINE, `${marks[1]} ${[...dates, today].join(', ')}`);
  writeFileSync(dataFile('habits.md'), markdown.replace(section, updated), 'utf8');
  return `ok: «${heading}» отмечена за ${today}, всего отметок ${dates.length + 1}`;
}

// --- Предпочтения (docs/specA.md) ---

/**
 * Дописывает подтверждённое предпочтение в `data/preferences.md`.
 *
 * Только дописывание: файл — накопительная память, и затирать прежние строки нельзя.
 * Повтор дословно того же текста игнорируется — сигнал «запомни» на одну и ту же фразу
 * приходит от прогона к прогону, и без этой проверки файл зарастал бы дублями.
 *
 * Файла может не быть — тогда он создаётся с шапкой: предпочтения появляются позже профиля.
 */
export function updatePreferences(preference: string): string {
  const body = preference.trim().replace(/\s+/g, ' ');
  if (!body) return 'нечего записывать: пустое предпочтение';

  const existing = readPreferences(); // он же и посеет файл из примера, если его ещё нет
  const line = `- ${todayIso()} · ${body}`;
  if (existing.includes(body)) return `ok: предпочтение уже записано, дубль не добавлен`;

  const header = existing || '# Подтверждённые предпочтения';
  writeFileSync(dataFile('preferences.md'), `${header}\n${line}\n`, 'utf8');
  return `ok: предпочтение записано в data/preferences.md (${body.length} символов)`;
}

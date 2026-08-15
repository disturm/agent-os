/**
 * Replay: прогнать задачу из старого трейса через текущий harness и показать, что изменилось.
 *
 *   npm run replay runs/run-2026-08-15T09-12-33-104Z.json
 *
 * Смысл — увидеть цену правки: поменяли промпт, переключили модель, тронули loop, и разница
 * видна построчно, а не «на глаз по ощущениям». Скрипт ничего не решает и ничего не чинит:
 * читает трейс, зовёт `runHealthAgent` и печатает сравнение. Новый прогон harness сам
 * запишет в `runs/` — его тоже можно будет взять за основу следующего сравнения.
 *
 * Прогон платный: те же 7+ вызовов модели, что и обычный запуск.
 */

import 'dotenv/config'; // первым: harness читает env при загрузке модуля
import { MODEL, runHealthAgent, type AgentResult } from '../src/harness/runHealthAgent';
import { readTrace, type RunTrace } from '../src/harness/traceRun';

const LABEL_WIDTH = 12;
const VALUE_WIDTH = 34;

/** Пустое значение: в старом трейсе поля может не быть, если формат с тех пор изменился. */
const dash = (value: string | undefined) => (value && value.length ? value : '—');

const seconds = (ms: number | undefined) => (typeof ms === 'number' ? `${(ms / 1000).toFixed(1)} с` : '—');

/** Сколько раундов и чем каждый кончился: `3: revise, revise, approve`. */
function roundsOf(rounds: { review: { verdict: string } }[] | undefined): string {
  if (!rounds?.length) return '—';
  return `${rounds.length}: ${rounds.map((r) => r.review.verdict).join(', ')}`;
}

function promptsOf(versions: { coach: string; reviewer: string } | undefined): string {
  return versions ? `coach ${versions.coach} / reviewer ${versions.reviewer}` : '—';
}

/**
 * Строка сравнения. Маркер стоит первым, а не последним: длина значений заранее неизвестна,
 * и колонка «изменилось» уехала бы вразнос.
 *
 * Значение шире колонки (список из семи инструментов — обычное дело) ломает таблицу:
 * «было» наезжает на «стало», и разницу приходится вылавливать глазами. Такие пары
 * печатаются блоком в две строки — выравнивание важнее единообразия.
 */
function row(label: string, before: string, after: string, compare = true): void {
  const mark = !compare ? ' ' : before === after ? '=' : '≠';
  if (before.length <= VALUE_WIDTH && after.length <= VALUE_WIDTH) {
    console.log(`${mark} ${label.padEnd(LABEL_WIDTH)} ${before.padEnd(VALUE_WIDTH)} ${after}`);
    return;
  }
  console.log(`${mark} ${label}`);
  console.log(`    было:  ${before}`);
  console.log(`    стало: ${after}`);
}

function printDiff(trace: RunTrace, fresh: AgentResult): void {
  console.log(`\n=== Сравнение: трейс ${trace.runId} vs текущий прогон ===\n`);
  console.log(`  ${'Параметр'.padEnd(LABEL_WIDTH)} ${'Было'.padEnd(VALUE_WIDTH)} Стало`);

  row('verdict', dash(trace.verdict), fresh.review.verdict);
  row('score', `${dash(trace.finalScore?.toString())}/10`, `${fresh.finalScore}/10`);
  row('раунды', roundsOf(trace.rounds), roundsOf(fresh.rounds));
  row('toolCalls', dash(trace.toolCalls?.join(', ')), dash(fresh.toolCalls.join(', ')));
  row('промпты', promptsOf(trace.promptVersions), promptsOf(fresh.promptVersions));
  row('модель', dash(trace.model), MODEL);
  // Время сравнивать бессмысленно: оно пляшет от нагрузки на провайдера, а не от наших правок
  row('время', seconds(trace.durationMs), seconds(fresh.durationMs), false);

  console.log('\n≠ — значение изменилось, = — осталось прежним.');
}

async function main(): Promise<number> {
  const path = process.argv[2];
  if (!path) {
    console.error('Использование: npm run replay runs/run-XXX.json');
    return 1;
  }

  const trace = readTrace(path);
  console.log(`Трейс: ${path}`);
  console.log(`Записан: ${dash(trace.createdAt)}`);
  console.log(`Задача: ${trace.task}\n`);
  console.log('Прогоняю ту же задачу через текущий harness...\n');

  const fresh = await runHealthAgent(trace.task);
  printDiff(trace, fresh);
  return 0;
}

process.exitCode = await main().catch((err: unknown) => {
  console.error(`Ошибка: ${err instanceof Error ? err.message : String(err)}`);
  return 1;
});

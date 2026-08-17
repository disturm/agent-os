/**
 * Мини-evals: прогнать набор кейсов из `evals/cases/*.json` и показать таблицу PASS/FAIL.
 *
 *   npm run eval
 *
 * Это не фреймворк и не тесты: один скрипт, последовательный цикл, никаких параллельных
 * прогонов и воркеров. Кейс — это файл вида
 * `{ name, task, expect: { verdict: "approve" | "needs_human_professional", minScore? } }`;
 * новый кейс добавляется файлом, править скрипт для этого не нужно.
 *
 * Главный кейс здесь — `bad-medical-request`: он проходит только если агент остановился
 * на `needs_human_professional`. Предохранитель — не edge case, поэтому его состояние
 * проверяется наравне с остальным, а не «когда-нибудь руками».
 *
 * Прогон платный и не быстрый: пять кейсов — это пять полных циклов, порядка 30+ вызовов модели.
 */

import 'dotenv/config'; // первым: harness читает env при загрузке модуля
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { runHealthAgent } from '../src/harness/runHealthAgent';
import { calledTool } from '../src/harness/toolCalls';

const CASES_DIR = join(process.cwd(), 'evals', 'cases');

/**
 * Форма кейса. Ожидать `revise` нельзя намеренно: «план не одобрен за три раунда» —
 * это отказ агента, а не желаемый результат, и закреплять его кейсом незачем.
 */
const CaseSchema = z.object({
  name: z.string().min(1),
  task: z.string().min(1),
  expect: z.object({
    verdict: z.enum(['approve', 'needs_human_professional']),
    /** Нижняя граница оценки: одобрение само по себе ещё не значит, что план хорош. */
    minScore: z.number().min(0).max(10).optional(),
    /**
     * Инструмент, который агент обязан был вызвать. Источник не указывается — проверяется
     * факт вызова, а с какого сервера пришёл инструмент, кейса не касается.
     *
     * Нужно это для проверок вида «план опирался на базу знаний, а не на фантазию»:
     * вердикт `approve` сам по себе такого не гарантирует (`usedTool: "searchKnowledge"`).
     */
    usedTool: z.string().min(1).optional(),
  }),
});
type EvalCase = z.infer<typeof CaseSchema>;

type CaseResult = {
  name: string;
  expected: string;
  got: string;
  score: string;
  passed: boolean;
  /** Почему FAIL — печатается отдельной строкой под таблицей. */
  reason?: string;
};

function loadCases(): EvalCase[] {
  const files = readdirSync(CASES_DIR)
    .filter((file) => file.endsWith('.json'))
    .sort();
  if (!files.length) throw new Error(`В ${CASES_DIR} нет ни одного кейса`);

  return files.map((file) => {
    const parsed = CaseSchema.safeParse(JSON.parse(readFileSync(join(CASES_DIR, file), 'utf8')));
    if (!parsed.success) throw new Error(`Кейс ${file} не той формы: ${parsed.error.issues.map((i) => i.message).join('; ')}`);
    return parsed.data;
  });
}

async function runCase(testCase: EvalCase): Promise<CaseResult> {
  const { name, expect } = testCase;
  const expected = [
    expect.verdict,
    expect.minScore === undefined ? '' : `score ≥ ${expect.minScore}`,
    expect.usedTool ? `+${expect.usedTool}` : '',
  ]
    .filter(Boolean)
    .join(', ');

  try {
    const { review, finalScore, toolCalls } = await runHealthAgent(testCase.task);

    if (review.verdict !== expect.verdict) {
      return { name, expected, got: review.verdict, score: `${finalScore}/10`, passed: false, reason: `ожидался verdict ${expect.verdict}` };
    }
    if (expect.minScore !== undefined && finalScore < expect.minScore) {
      return { name, expected, got: review.verdict, score: `${finalScore}/10`, passed: false, reason: `score ${finalScore} ниже порога ${expect.minScore}` };
    }
    if (expect.usedTool && !calledTool(toolCalls, expect.usedTool)) {
      return { name, expected, got: review.verdict, score: `${finalScore}/10`, passed: false, reason: `агент не вызвал ${expect.usedTool}` };
    }
    return { name, expected, got: review.verdict, score: `${finalScore}/10`, passed: true };
  } catch (err: unknown) {
    // Упавший прогон — это FAIL кейса, а не падение всего набора: остальные ещё имеет смысл прогнать
    return { name, expected, got: 'ошибка', score: '—', passed: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

function printTable(results: CaseResult[]): void {
  const width = (pick: (r: CaseResult) => string, header: string) =>
    Math.max(header.length, ...results.map((r) => pick(r).length));
  const nameW = width((r) => r.name, 'КЕЙС');
  const expectedW = width((r) => r.expected, 'ОЖИДАЛОСЬ');
  const gotW = width((r) => r.got, 'ПОЛУЧЕНО');

  console.log(`\n=== Evals: ${results.length} кейс(ов) ===\n`);
  console.log(`${'КЕЙС'.padEnd(nameW)}  ${'ОЖИДАЛОСЬ'.padEnd(expectedW)}  ${'ПОЛУЧЕНО'.padEnd(gotW)}  SCORE  ИТОГ`);
  for (const r of results) {
    console.log(
      `${r.name.padEnd(nameW)}  ${r.expected.padEnd(expectedW)}  ${r.got.padEnd(gotW)}  ${r.score.padStart(5)}  ${r.passed ? 'PASS' : 'FAIL'}`,
    );
  }

  const failed = results.filter((r) => !r.passed);
  if (failed.length) {
    console.log('');
    for (const r of failed) console.log(`FAIL ${r.name}: ${r.reason}`);
  }
  console.log(`\nИтог: ${results.length - failed.length}/${results.length} PASS`);
}

async function main(): Promise<number> {
  const cases = loadCases();
  console.log(`Кейсов: ${cases.length}. Прогон последовательный, каждый — полный цикл коуч→ревьюер.\n`);

  const results: CaseResult[] = [];
  for (const [index, testCase] of cases.entries()) {
    console.log(`\n--- [${index + 1}/${cases.length}] ${testCase.name} ---`);
    results.push(await runCase(testCase));
  }

  printTable(results);
  return results.every((r) => r.passed) ? 0 : 1;
}

process.exitCode = await main().catch((err: unknown) => {
  console.error(`Ошибка: ${err instanceof Error ? err.message : String(err)}`);
  return 1;
});

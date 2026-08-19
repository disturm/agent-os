// Тонкий CLI-враппер над OS: вся логика живёт в src/os/runOS.ts и src/harness/runHealthAgent.ts
import 'dotenv/config'; // должен быть первым: harness читает env при загрузке модуля
import { runOS } from './src/os/runOS';

async function main(): Promise<number> {
  const task = process.argv[2];
  if (!task) {
    console.error('Использование: npx tsx index.ts "составь план питания на завтра"');
    return 1;
  }

  const { review } = await runOS(task);
  return review.verdict === 'revise' ? 1 : 0;
}

process.exitCode = await main().catch((err: unknown) => {
  console.error(`Ошибка: ${err instanceof Error ? err.message : String(err)}`);
  return 1;
});

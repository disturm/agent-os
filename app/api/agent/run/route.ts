import { runHealthAgent } from '../../../../src/harness/runHealthAgent';

export const maxDuration = 300; // цикл до 3 раундов — это долго

export async function POST(request: Request) {
  let task: unknown;
  try {
    ({ task } = await request.json());
  } catch {
    return Response.json({ error: 'Ожидается JSON вида { task }' }, { status: 400 });
  }

  if (typeof task !== 'string' || !task.trim()) {
    return Response.json({ error: 'Задача пустая' }, { status: 400 });
  }

  try {
    return Response.json(await runHealthAgent(task.trim()));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Ошибка: ${message}`);
    return Response.json({ error: message }, { status: 500 });
  }
}

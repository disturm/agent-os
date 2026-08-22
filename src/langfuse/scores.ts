/**
 * Результаты evals как scores в Langfuse (`docs/specB.md`).
 *
 * Кейс закончился — к трейсу его прогона привязываются две оценки: прошёл или нет и какой
 * score поставил ревьюер. Именно к трейсу, а не отдельной таблицей: иначе «почему упало»
 * пришлось бы искать сопоставлением по времени, а так FAIL открывается прямо в дерево спанов.
 *
 * Привязка держится на `traceId`, который прогон вернул в `AgentResult` (см. `runHealthAgent`).
 * Нет его — Langfuse выключен, и писать всё равно некуда.
 */

import { langfuseClient, quietly } from './client';

export type EvalOutcome = {
  /** Имя кейса: уезжает в комментарий, чтобы score читался без открытия трейса. */
  name: string;
  passed: boolean;
  /** Оценка ревьюера, 0…10. `undefined` — прогон упал и оценки не было. */
  score?: number;
  /** Причина FAIL. */
  reason?: string;
};

/**
 * Пишет оценки кейса. Langfuse выключен или трейса нет — молча ничего не делает.
 *
 * Две оценки, а не одна: `eval-passed` отвечает на вопрос «набор зелёный?», `eval-score` —
 * «насколько хорош план». Схлопывать их нельзя, они расходятся: кейс с `minScore` может
 * пройти на 7 из 10, и на графике это разные линии.
 */
export async function recordEvalOutcome(traceId: string | undefined, outcome: EvalOutcome): Promise<void> {
  const client = langfuseClient();
  if (!client || !traceId) return;

  await quietly(`оценки кейса ${outcome.name} не записаны`, async () => {
    client.score.create({
      traceId,
      name: 'eval-passed',
      value: outcome.passed ? 1 : 0,
      dataType: 'BOOLEAN',
      comment: outcome.reason ?? outcome.name,
    });
    if (outcome.score !== undefined) {
      client.score.create({ traceId, name: 'eval-score', value: outcome.score, dataType: 'NUMERIC', comment: outcome.name });
    }
    // Очередь scores отправляется по размеру и по таймеру; скрипт может закончиться раньше,
    // поэтому дожимаем явно — иначе последние кейсы набора просто не доедут.
    await client.score.flush();
  });
}

/**
 * Прогон → дерево наблюдений в Langfuse (`docs/specB.md`).
 *
 * Единственное место, где след прогона превращается в спаны. Дерево строится **постфактум**,
 * из уже собранных наблюдений, — поэтому здесь и не понадобился OTEL: у каждого спана свои
 * `startTime`/`endTime`, и живой контекст исполнения для этого не нужен.
 *
 *   trace  (задача → план; module, вердикт, score, версии промптов)
 *   ├── round-1
 *   │   ├── generation coach      (модель, токены, стоимость)
 *   │   ├── span       tool call  ([weather] weather_forecast)
 *   │   ├── span       retrieval  (запрос → заголовки)
 *   │   └── generation reviewer   (вердикт целиком)
 *   ├── round-2 …
 *   └── span save-plan
 *
 * Локальные `runs/*.json` этим не отменяются: спека требует двойной записи, и разбор
 * постфактум по-прежнему идёт через replay и evals. Ошибка отправки прогон не роняет.
 *
 * ЗАМЕЧАНИЕ ПРО ENDPOINT: batch-ingestion помечен в SDK как legacy — Langfuse продвигает
 * OTEL-приём. Он поддерживается и обслуживается, а альтернатива стоила бы глобального
 * tracer provider ради механики живой инструментации, которой мы не пользуемся (см.
 * `docs/superpowers/specs/2026-08-22-specB-production-upgrade-design.md`, §2).
 */

import { randomUUID } from 'node:crypto';
import type { IngestionEvent } from '@langfuse/core';
import type { Observation } from '../harness/observations';
import { langfuseClient, quietly } from './client';

/** Потолок на текст в спане. Батч ограничен 3.5 МБ, а чанки базы знаний бывают длинными. */
const FIELD_LIMIT = 10_000;

/** Что платформе нужно знать о прогоне. Структурный тип: про `AgentResult` модуль не знает. */
export type RunTraceInput = {
  traceId: string;
  task: string;
  plan: string;
  model: string;
  verdict: string;
  finalRound: number;
  finalScore: number;
  reviewRetries: number;
  durationMs: number;
  promptVersions: Record<string, string>;
  /** Маршрутизация OS. Нет её — прогон шёл мимо роутера. */
  routing?: { module: string; intentConfidence: number };
  observations: Observation[];
};

function clip(value: unknown): unknown {
  if (typeof value !== 'string' || value.length <= FIELD_LIMIT) return value;
  return `${value.slice(0, FIELD_LIMIT)}… [обрезано, всего ${value.length} символов]`;
}

/** Конверт события ingestion: свой id на каждое, он же ключ дедупликации на стороне платформы. */
function envelope<T extends IngestionEvent['type'], B>(type: T, body: B) {
  return { id: randomUUID(), timestamp: new Date().toISOString(), type, body } as IngestionEvent;
}

/**
 * Наблюдение → событие. Вызовы модели уезжают generation-ами (у них модель, токены
 * и стоимость), остальное — обычными спанами.
 */
function observationEvent(observation: Observation, traceId: string, parentObservationId?: string): IngestionEvent {
  const common = {
    id: randomUUID(),
    traceId,
    parentObservationId,
    name: observation.name,
    startTime: observation.startedAt,
    endTime: observation.endedAt || observation.startedAt,
    input: clip(observation.input),
    output: clip(observation.output),
    metadata: observation.metadata,
  };

  if (observation.kind !== 'generation') return envelope('span-create', common);

  const { inputTokens, outputTokens, totalTokens, cost } = observation.usage ?? {};
  return envelope('generation-create', {
    ...common,
    model: observation.model,
    // Пустые поля не отправляем: Langfuse умеет досчитать стоимость по модели и токенам,
    // а вот нулями её затирать нельзя — получится «вызов бесплатный».
    usageDetails: {
      ...(inputTokens === undefined ? {} : { input: inputTokens }),
      ...(outputTokens === undefined ? {} : { output: outputTokens }),
      ...(totalTokens === undefined ? {} : { total: totalTokens }),
    },
    ...(cost === undefined ? {} : { costDetails: { total: cost } }),
  });
}

/**
 * Спан раунда. Границы берутся по детям, а не по часам отправки: раунд длится ровно
 * столько, сколько заняли его шаги.
 */
function roundSpan(round: number, children: Observation[], traceId: string) {
  const id = randomUUID();
  const starts = children.map((child) => child.startedAt).sort();
  const ends = children.map((child) => child.endedAt || child.startedAt).sort();
  return {
    id,
    event: envelope('span-create', {
      id,
      traceId,
      name: `round-${round}`,
      startTime: starts[0],
      endTime: ends[ends.length - 1],
      metadata: { round },
    }),
  };
}

/**
 * Отправляет прогон в Langfuse. Выключен — молча ничего не делает; сломался — предупреждает
 * в лог и возвращает управление. Прогон к этому моменту готов и оплачен.
 */
export async function sendRunToLangfuse(input: RunTraceInput): Promise<void> {
  const client = langfuseClient();
  if (!client) return;

  await quietly('трейс не отправлен', async () => {
    const { traceId, observations, routing } = input;

    const batch: IngestionEvent[] = [
      envelope('trace-create', {
        id: traceId,
        name: 'agent-run',
        timestamp: observations[0]?.startedAt ?? new Date().toISOString(),
        input: clip(input.task),
        output: clip(input.plan),
        tags: [routing?.module, input.verdict].filter(Boolean) as string[],
        metadata: {
          module: routing?.module,
          intentConfidence: routing?.intentConfidence,
          promptVersions: input.promptVersions,
          model: input.model,
          finalRound: input.finalRound,
          finalScore: input.finalScore,
          // Счётчик ретраев ревьюера — та самая метрика, ради которой затевались
          // structured outputs: на нативном JSON-режиме она обязана быть нулём.
          reviewRetries: input.reviewRetries,
          durationMs: input.durationMs,
        },
      }),
    ];

    // Шаги вне раундов (фиксация плана) висят прямо на трейсе: им не к какому кругу относиться.
    const rounds = [...new Set(observations.map((o) => o.round).filter((r): r is number => r !== undefined))].sort();
    const parents = new Map<number, string>();
    for (const round of rounds) {
      const { id, event } = roundSpan(
        round,
        observations.filter((o) => o.round === round),
        traceId,
      );
      parents.set(round, id);
      batch.push(event);
    }

    for (const observation of observations) {
      const parent = observation.round === undefined ? undefined : parents.get(observation.round);
      batch.push(observationEvent(observation, traceId, parent));
    }

    await client.api.ingestion.batch({ batch });
    console.log(`Langfuse: трейс ${traceId} (${batch.length - 1} наблюдений)`);
  });
}

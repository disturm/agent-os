/**
 * Стриминговый роут чата (`docs/spec9.md`).
 *
 * Тонкая обёртка, как и соседний `/api/agent/run`: прогон целиком принадлежит harness,
 * перевод его событий в части стрима — `timeline.ts`, а здесь только разбор запроса,
 * порядок трёх выходов (таймлайн → текст плана → итог) и ответ.
 *
 * Истории чата в промпт не уходит: одна задача — один прогон, состояния между запросами
 * в проекте нет (`docs/spec2.md`). `messages` нужны ровно затем, чтобы взять из последнего
 * сообщения текст задачи.
 */

import { createUIMessageStream, createUIMessageStreamResponse, type UIMessageStreamWriter } from 'ai';
import { runHealthAgent } from '../../../src/harness/runHealthAgent';
import type { ChatMessage } from '../../../lib/chat-stream';
import { createTimeline } from './timeline';

export const maxDuration = 300; // цикл до 3 раундов — это долго

/**
 * Печать плана.
 *
 * Текст к этому моменту готов целиком: коуч написал его, ревьюер одобрил — иначе плана
 * бы не было вовсе. Так что это доигрывание готовой строки, а не токены модели; пауза
 * нужна только затем, чтобы план проявлялся, а не возникал одним кадром. Без неё все
 * части уехали бы в один тик и «стриминг» ничем не отличался бы от обычного ответа.
 */
const WORDS_PER_CHUNK = 3;
const CHUNK_DELAY_MS = 10;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Текст последнего сообщения пользователя: он и есть задача прогона. */
function lastUserText(messages: ChatMessage[]): string {
  const last = [...messages].reverse().find((message) => message.role === 'user');
  return (last?.parts ?? [])
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n')
    .trim();
}

/** Разбивает план по словам, сохраняя пробелы и переносы: markdown обязан доехать целым. */
function chunkPlan(plan: string): string[] {
  const words = plan.match(/\S+\s*/g) ?? [];
  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += WORDS_PER_CHUNK) {
    chunks.push(words.slice(i, i + WORDS_PER_CHUNK).join(''));
  }
  return chunks;
}

async function streamPlan(writer: UIMessageStreamWriter<ChatMessage>, plan: string) {
  const id = 'plan';
  writer.write({ type: 'text-start', id });
  for (const chunk of chunkPlan(plan)) {
    writer.write({ type: 'text-delta', id, delta: chunk });
    await sleep(CHUNK_DELAY_MS);
  }
  writer.write({ type: 'text-end', id });
}

export async function POST(request: Request) {
  let messages: ChatMessage[];
  try {
    ({ messages } = await request.json());
  } catch {
    return Response.json({ error: 'Ожидается JSON вида { messages }' }, { status: 400 });
  }

  const task = Array.isArray(messages) ? lastUserText(messages) : '';
  if (!task) return Response.json({ error: 'Задача пустая' }, { status: 400 });

  const stream = createUIMessageStream<ChatMessage>({
    execute: async ({ writer }) => {
      const timeline = createTimeline(writer);
      const result = await runHealthAgent(task, { onEvent: timeline.handle });
      timeline.closeSteps(result);

      // Предохранитель: плана нет и печатать нечего — вместо него карточка со специалистом.
      if (result.review.verdict === 'needs_human_professional') {
        writer.write({ type: 'data-blocked', id: 'blocked', data: { issues: result.review.issues } });
      } else {
        await streamPlan(writer, result.plan);
      }

      // Итог пишется последним: части рисуются в порядке записи, а вердикт нужен под планом.
      timeline.summarize(result);
    },
    // Локальный инструмент, а не публичный сервис: текст ошибки полезнее, чем «что-то пошло не так».
    onError: (error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Ошибка: ${message}`);
      return message;
    },
  });

  return createUIMessageStreamResponse({ stream });
}

/**
 * Skill: поиск по базе знаний (RAG).
 *
 * Сам поиск живёт в `src/rag/retriever.ts` — здесь только обёртка в `tool()`: описание для
 * модели, схема параметров и формат выдачи. Разделение то же, что у остальных навыков:
 * инструмент — это интерфейс, а не алгоритм.
 *
 * Отличие от соседей — фабрика вместо готового `tool()`. Причина в наблюдаемости: в
 * `toolCalls` попадает только имя, а от retrieval нужен ещё и запрос с заголовками найденных
 * секций, иначе по трейсу не понять, чем агент пользовался и почему план выглядит так.
 * Разбирать вывод модели ради этого не нужно: harness передаёт колбэк и копит записи сам —
 * тем же приёмом, что `validateReview(ask)`. Модуль не знает, кто и куда их складывает.
 */

import { tool } from '@openai/agents';
import { z } from 'zod';
import { DEFAULT_TOP_K, searchKnowledge, type KnowledgeChunk } from '../rag/retriever';

/** Что осталось от одного вызова инструмента для трейса и UI: запрос и заголовки найденного. */
export type RetrievalRecord = {
  query: string;
  /** Заголовки секций в порядке убывания похожести. Тексты не храним — трейс не архив. */
  headings: string[];
};

export type OnRetrieval = (record: RetrievalRecord) => void;

/** Имя инструмента. Вынесено, потому что его же ищет `calledTool` в evals и в harness. */
export const SEARCH_KNOWLEDGE_TOOL = 'searchKnowledge';

const DESCRIPTION = [
  'Ищи в базе знаний рецепты, правила питания, шаблоны тренировок, правила восстановления',
  'и приёмы работы с предпочтениями. Это общая база проекта, а не данные пользователя:',
  'личное (профиль, дневник) берётся read_profile и read_recent_logs.',
  'Вызывай перед тем, как писать любой раздел плана, и формулируй запрос содержательно —',
  'поиск идёт по смыслу, а не по словам: «ужин с высоким белком без молочных продуктов»',
  'работает лучше, чем «ужин». Нужны разные темы (еда и восстановление) — вызови дважды',
  'с разными запросами. Опирайся на найденные секции и не сочиняй рецептов и норм от себя.',
].join(' ');

/** Пустая выдача — тоже ответ: без этой строки модель решает, что инструмент сломался, и выдумывает. */
const NOTHING_FOUND = 'В базе знаний ничего похожего не нашлось. Не выдумывай содержимое — обойдись тем, что уже известно.';

/** Одна секция для модели: видно, откуда она и насколько близка к запросу. */
function formatChunk({ file, heading, content, similarity }: KnowledgeChunk): string {
  return `### ${heading}\nИсточник: knowledge/${file}, похожесть ${similarity.toFixed(2)}\n\n${content.trim()}`;
}

/**
 * Инструмент поиска для конкретного прогона.
 *
 * `onRetrieval` зовётся на каждый вызов, включая пустую выдачу: «искал и не нашёл» —
 * такой же факт прогона, как и «нашёл пять секций», и в разборе он важнее.
 */
export function createKnowledgeSearch(onRetrieval: OnRetrieval) {
  return tool({
    name: SEARCH_KNOWLEDGE_TOOL,
    description: DESCRIPTION,
    parameters: z.object({
      query: z
        .string()
        .describe(
          'Что ищем, обычной фразой на русском: «ужин с высоким белком без молочки», ' +
            '«тренировка на низ тела при травме колена», «сколько спать и как ложиться вовремя».',
        ),
      topK: z
        .number()
        .int()
        .min(1)
        .max(10)
        .nullable()
        .describe(`Сколько секций вернуть. Обычно ${DEFAULT_TOP_K}; больше — если тема широкая. Можно null.`),
    }),
    execute: async ({ query, topK }) => {
      const chunks = await searchKnowledge(query, topK ?? DEFAULT_TOP_K);
      onRetrieval({ query: query.trim(), headings: chunks.map((chunk) => chunk.heading) });

      if (!chunks.length) return NOTHING_FOUND;
      return chunks.map(formatChunk).join('\n\n---\n\n');
    },
  });
}

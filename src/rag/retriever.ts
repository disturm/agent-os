/**
 * Поиск по базе знаний: запрос → вектор → ближайшие чанки.
 *
 * Вся склейка RAG живёт здесь и занимает три строки: векторизовать запрос (`embedding.ts`),
 * позвать SQL-функцию (`supabaseRest.ts`), отдать чанки наружу. Ни reranking, ни hybrid
 * search, ни переписывания запроса — один embed и один similarity search (`docs/spec8.md`).
 *
 * Про агента и про инструменты модуль не знает: это обычная асинхронная функция, которую
 * с тем же успехом можно позвать из скрипта. Обёртка в `tool()` лежит отдельно,
 * в `src/skills/knowledge.ts`.
 *
 * Что здесь ищется: knowledge/*.md — рецепты, правила питания, шаблоны тренировок, правила
 * восстановления, приёмы работы с предпочтениями. Личная память пользователя (профиль,
 * дневник) сюда не переезжала и лежит по-прежнему в markdown за MCP-сервером.
 */

import { assertEmbeddingConfigured, embed } from './embedding';
import { assertSupabaseConfigured, rpc } from './supabaseRest';

/** Таблица чанков. Заводится миграцией `docs/001_create_knowledge_chunks_table.sql`. */
export const KNOWLEDGE_TABLE = 'knowledge_chunks';

/** SQL-функция поиска. Заводится миграцией `docs/002_create_match_knowledge_chunks_function.sql`. */
const MATCH_FUNCTION = 'match_knowledge_chunks';

/** Сколько чанков возвращать по умолчанию. Пять — столько влезает в контекст, не вытесняя задачу. */
export const DEFAULT_TOP_K = 5;

/** Потолок на случай, если число придёт от модели: сотня чанков в промпте — это не поиск, а свалка. */
const MAX_TOP_K = 20;

export type KnowledgeChunk = {
  /** Имя файла-источника: `recipes.md`, `nutrition_rules.md`. */
  file: string;
  /** Заголовок секции без `##` — он же уезжает в трейс и в UI. */
  heading: string;
  content: string;
  /** Косинусная близость, 1 — совпадение. Считается в SQL-функции. */
  similarity: number;
};

/**
 * Проверка, что RAG вообще настроен, без обращения к сети и к провайдеру.
 *
 * Зовётся до первого платного вызова модели — по той же логике, по которой падает запуск
 * MCP-сервера: инструмент, который сломается в середине прогона, оставит агента без
 * источника, и тот пойдёт сочинять рецепты из головы. Дешевле не начинать.
 */
export function assertRagConfigured(): void {
  assertEmbeddingConfigured();
  assertSupabaseConfigured();
}

/**
 * Ближайшие к запросу секции базы знаний, от самой похожей к самой далёкой.
 *
 * Пустой запрос не векторизуем: платить провайдеру за поиск «ничего» незачем, а модель
 * иногда зовёт инструмент с пустой строкой.
 */
export async function searchKnowledge(query: string, topK: number = DEFAULT_TOP_K): Promise<KnowledgeChunk[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const queryEmbedding = await embed(trimmed);
  const matchCount = Math.min(Math.max(Math.trunc(topK) || DEFAULT_TOP_K, 1), MAX_TOP_K);

  const rows = await rpc<KnowledgeChunk[]>(MATCH_FUNCTION, {
    query_embedding: queryEmbedding,
    match_count: matchCount,
  });

  return (rows ?? []).map(({ file, heading, content, similarity }) => ({ file, heading, content, similarity }));
}

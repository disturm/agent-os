-- 002: функция поиска ближайших чанков. Выполнять после 001.
--
-- Зачем она нужна: приложение ходит в Supabase через PostgREST (обычный fetch, без
-- клиентских библиотек), а PostgREST не умеет сортировать по оператору `<=>`. Поэтому
-- сам запрос по вектору живёт здесь, в базе, и вызывается как RPC:
--   POST /rest/v1/rpc/match_knowledge_chunks  { query_embedding, match_count }
--
-- Один embed запроса, один similarity search и ничего больше: ни reranking,
-- ни hybrid search, ни переписывания запроса (docs/spec8.md).

-- Тип параметра резолвится search_path'ом сессии в момент создания функции, а не её же
-- `set search_path` ниже. Поэтому схема ставится в путь здесь, до create function.
set search_path = public, extensions;

create or replace function public.match_knowledge_chunks(
  query_embedding vector(1536),
  match_count     int default 5
)
returns table (
  id         bigint,
  file       text,
  heading    text,
  content    text,
  similarity float
)
language sql
stable
-- Функция читает таблицу с включённым RLS и вызывается по service role key,
-- который RLS и так обходит; `security invoker` (по умолчанию) это сохраняет.
set search_path = public, extensions
as $$
  select
    kc.id,
    kc.file,
    kc.heading,
    kc.content,
    -- `<=>` даёт косинусное РАССТОЯНИЕ (0 — совпадение, 2 — противоположность).
    -- Наружу отдаём привычную similarity: 1 — совпадение, 0 — ничего общего.
    1 - (kc.embedding <=> query_embedding) as similarity
  from public.knowledge_chunks as kc
  order by kc.embedding <=> query_embedding
  limit greatest(match_count, 1);
$$;

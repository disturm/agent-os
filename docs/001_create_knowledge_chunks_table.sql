-- 001: таблица чанков базы знаний и индекс под векторный поиск.
--
-- Выполнять в SQL Editor проекта Supabase (или через psql по DATABASE_URL) один раз,
-- до первого `npm run ingest`. Порядок файлов важен: 002 создаёт функцию поиска поверх
-- этой таблицы.
--
-- Что здесь лежит: только база знаний из knowledge/*.md — рецепты, правила питания,
-- шаблоны тренировок, правила восстановления, приёмы работы с предпочтениями.
-- Личная память пользователя (data/profile.md, data/log.md) в БД не переезжает
-- и остаётся markdown-файлами за MCP-сервером (docs/spec8.md).

-- pgvector: тип vector и операторы расстояния. В Supabase расширение доступно,
-- но по умолчанию не включено.
create extension if not exists vector with schema extensions;

-- Схему в путь, а не в каждое имя типа: `extensions.vector(1536)` сломается на проектах,
-- где расширение уже стояло в `public`. Так работает и то и другое.
set search_path = public, extensions;

create table if not exists public.knowledge_chunks (
  id          bigint generated always as identity primary key,
  -- Имя файла-источника (`recipes.md`) и заголовок секции (`## Запечённая треска…`).
  -- Пара file+heading — то, что видит человек в трейсе и в UI: по ней понятно,
  -- чем именно агент пользовался.
  file        text        not null,
  heading     text        not null,
  content     text        not null,
  -- 1536 — размерность text-embedding-3-small. Сменили модель эмбеддингов —
  -- размерность здесь и EMBEDDING_MODEL в .env меняются вместе, иначе вставка
  -- упадёт на несовпадении длины вектора.
  embedding   vector(1536) not null, -- тип из pgvector, см. search_path выше
  created_at  timestamptz  not null default now()
);

-- HNSW по косинусному расстоянию: тот же оператор `<=>`, что и в функции поиска (002).
-- ivfflat здесь не подходит — он требует заполненной таблицы на момент создания индекса,
-- а `npm run ingest` каждый раз очищает её целиком.
create index if not exists knowledge_chunks_embedding_idx
  on public.knowledge_chunks
  using hnsw (embedding vector_cosine_ops);

-- По файлу-источнику иногда удобно посмотреть глазами, что вообще залилось.
create index if not exists knowledge_chunks_file_idx
  on public.knowledge_chunks (file);

-- RLS включён без единой политики: значит, снаружи (anon, authenticated) таблица
-- недоступна вовсе. Ходит в неё только сервер приложения — по service role key,
-- а он RLS обходит. Публиковать базу знаний в браузер незачем: и ingest, и retrieval
-- живут на сервере.
alter table public.knowledge_chunks enable row level security;

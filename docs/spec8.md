## Контекст
Next.js-приложение: агент Health Coach + Safety Reviewer, harness (loop, traces, evals, replay), MCP-слой (свой markdown-сервер + внешний filesystem по конфигу), локальные tools shopping/workouts. Память агента — markdown-файлы (profile, log). Никакой БД в проекте нет.



## Задача
Добавь простой RAG: базу знаний, embeddings в Supabase pgvector и retrieval-tool для агента.

1) База знаний — knowledge/:
   recipes.md, nutrition_rules.md, training_templates.md, recovery_rules.md, personal_preferences.md
   Заполни правдоподобным учебным контентом (по 10–15 небольших секций с ## заголовками в каждом файле).

2) Ингест — scripts/ingest.ts:
   - chunking по ## секциям (1 секция = 1 chunk, метаданные: file, heading)
   - embeddings через OpenAI-compatible endpoint (модель из .env)
   - запись в Supabase: таблица knowledge_chunks (id, file, heading, content, embedding vector)
   - SQL-миграция создания таблицы и индекса — supabase/migrations/001_knowledge.sql
   - `npm run ingest` идемпотентен: очищает и заливает заново

3) Retriever — src/rag/retriever.ts:
   searchKnowledge(query, topK = 5): embed запроса → pgvector cosine similarity → chunks с file/heading/content/similarity

4) Интеграция: searchKnowledge подключается агенту как обычный tool с описанием «ищи в базе знаний рецепты, правила питания, шаблоны тренировок, правила восстановления». Новая версия промпта коуча: сначала искать в базе знаний, не выдумывать рецепты из головы.



## Требования
- В трейсе логируются запрос к retriever и заголовки найденных chunks — видно, чем агент пользовался.
- UI: в списке действий агента показывать «🔍 knowledge: <query> → N chunks».
- README: раздел «Memory vs RAG» — profile/log = личная память (кто ты), knowledge = база знаний (что мы умеем); объясни в 5–6 предложениях.



## Запрещено
- Никаких RAG-фреймворков (LangChain, LlamaIndex) — прямые SQL-запросы и fetch.
- Никакого reranking, hybrid search, query rewriting — один embed, один similarity search.
- Не переносить profile/log в БД — личная память остаётся в markdown/MCP.
- Не пиши тесты и TDD



## Definition of Done
- `npm run ingest` заливает все chunks, повторный запуск не создаёт дублей.
- Запрос «предложи ужин с высоким белком без молочки» → в трейсе виден retrieval, план опирается на chunks из knowledge/recipes.md.
- Кейсы evals проходят; добавь шестой кейс knowledge-based-recipe.json, проверяющий, что retrieval был вызван.

## При работе с БД и миграциями
- всегда создавай `.sql` файлы для любых SQL-запросов, которые пользователь должен выполнить
- помещай все `.sql` файлы в папку `/docs` в соответствующем проекте
- каждый файл должен начинаться с номера, чтобы фиксировать порядок выполнения операций
- вся схема базы данных должна быть задокументирована в папке `/docs` в отдельных `.sql` файлах
- называй файлы в таком формате: `001_create_x_table.sql`, `002_change_rls_policy.sql`, `003_add_foreign_key.sql` и т.д.

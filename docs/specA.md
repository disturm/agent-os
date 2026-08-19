## Контекст
Полноценное Next.js-приложение: чатовый стриминговый UI с таймлайном этапов; Health Coach + Safety Reviewer; harness (loop, traces в runs/, evals, replay, prompt versions, onEvent); MCP-слой (свой markdown-сервер + внешние по конфигу); RAG (Supabase pgvector, searchKnowledge); локальные tools (shopping, workouts). Память — markdown через MCP (profile, log, output).



## Задача
Собери всё в OS: intent routing, модули, обновление памяти после каждого запуска.

1) Модули — src/os/modules/:
   dailyPlan.ts, nutrition.ts, recipes.ts, training.ts, recovery.ts, habits.ts, shoppingList.ts, knowledge.ts
   Модуль = { name, description, promptFile, tools: string[] } — какие tools/MCP/RAG доступны и специализированный промпт (prompts/modules/*.md). Это конфигурация поверх существующего агента, НЕ отдельные агенты.

2) Router — src/os/router.ts:
   classifyIntent(task): быстрый LLM-вызов (дешёвая модель), возвращает имя модуля + confidence. При confidence < порога — модуль general (текущее поведение без специализации). Выбор модуля — событие в таймлайне UI: «🧭 Module: nutrition».

3) OS-флоу — src/os/runOS.ts (обёртка над runHealthAgent):
   task → classifyIntent → выбор модуля → runHealthAgent с промптом и tools модуля → safety review (без изменений, для всех модулей) → сохранение → memory update

4) Memory update — после approve:
   append_daily_log (краткая запись: дата, тип запроса, суть плана) через MCP;
   update_preferences: новый MCP-tool, дописывает подтверждённые предпочтения в data/preferences.md — вызывается harness-ом (не агентом) при явном сигнале пользователя в задаче («мне понравилось», «запомни»).

5) Финал: README-раздел «Путь проекта» — от одного index.ts до OS, по одному абзацу на слой: agent → UI → harness → tools → traces → MCP → RAG → chat → OS.



## Требования
- Safety Reviewer обязателен для каждого модуля — это инвариант системы, зафиксируй в коде комментарием и в evals (кейс на каждый из 3 разных модулей).
- Habit Tracker: минимальный — data/habits.md, MCP-tools read_habits/check_habit, модуль habits ими пользуется.
- Трейс дополняется полями module и intentConfidence.



## Запрещено
- Не делать мультиагентную оркестрацию (handoffs, подагенты) — один агент, разные конфигурации.
- Никакой авторизации, пользователей, мобильных приложений, wearables.
- Не усложнять router: один LLM-вызов со списком модулей и описаний.
- Не пиши тесты и TDD



## Definition of Done
- «составь план на завтра» → module dailyPlan; «что приготовить на ужин» → recipes; «болит колено, что делать» → safety-остановка независимо от модуля.
- Memory update виден: после approve в log.md появляется запись.
- Все evals проходят, включая 3 новых модульных кейса.

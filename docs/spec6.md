## Контекст
Next.js-приложение с агентом (Health Coach + Safety Reviewer), harness-слоем (loop, валидация, traces в runs/, evals, replay) и локальными skills в src/skills/ (getProfile, getRecentLog, savePlan, generateShoppingList, suggestWorkoutTemplate, listFavoriteRecipes). Skills — обычные функции, подключённые к агенту напрямую как tools. Данные — markdown в data/.



## Задача
Подними собственный MCP-сервер поверх markdown-файлов и переключи агента с прямых функций на MCP.

1) Сервер — src/mcp/markdownHealthServer.ts (@modelcontextprotocol/sdk, транспорт stdio):
   Tools:
     read_profile
     read_recent_logs (params: { days })
     append_daily_log (params: { entry })
     save_health_plan (params: { markdown })
     list_recipes
   Resources:
     profile://me      → data/profile.md
     logs://recent     → последние записи data/log.md
     recipes://all     → data/recipes.md
     plans://latest    → data/output.md

2) Клиент: подключи MCP-сервер к Health Coach Agent средствами OpenAI Agents SDK (MCP-серверы как источник tools). Локальные skills profile/logs/plans/recipes из подключения к агенту убери — их заменяет MCP. shopping и workouts оставь обычными tools: наглядный контраст «локальный tool vs MCP tool».

3) Скрипт для демо: `npm run mcp:inspect` — запускает сервер и печатает список его tools и resources (или инструкция для MCP Inspector в README).



## Требования
- Сервер — отдельный процесс, harness запускает его при старте запуска и корректно закрывает.
- В trace имена MCP-tools логируются в тот же toolCalls — ученик видит, что для агента это такие же инструменты.
- В README раздел «До MCP / После MCP»: раньше каждая интеграция — руками, теперь — стандартный сервер.



## Запрещено
- Никаких внешних MCP-серверов и сетевых транспортов — только свой stdio-сервер.
- Не переносить в MCP то, что не про данные (score, валидация — остаются в harness).
- Не удалять src/skills/ полностью — shopping и workouts остаются локальными tools.
- Не пиши тесты и TDD



## Definition of Done
- Запрос из UI работает как раньше, но профиль/логи/рецепты/сохранение плана идут через MCP.
- В трейсе видны MCP tool calls.
- `npm run eval` проходит без изменений кейсов.

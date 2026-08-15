## Контекст
Next.js-приложение с harness-слоем: src/harness/ (runHealthAgent, validateReview, rounds, score, promptVersions), агенты в src/agents/, промпты в prompts/*.md, данные в data/*.md. Сейчас profile.md и log.md целиком подставляются в контекст коуча при старте.



## Задача
Убери «весь контекст в промпт» и дай агенту tools (function calling через OpenAI Agents SDK). Агент сам решает, какие данные ему нужны.

src/skills/
  profile.ts        — getProfile(): содержимое data/profile.md
  logs.ts           — getRecentLog(days): последние N дней из data/log.md
  plans.ts          — savePlan(markdown): пишет в data/output.md, возвращает ok
  shopping.ts       — generateShoppingList(planMarkdown): извлекает продукты из плана, пишет data/shopping.md
  workouts.ts       — suggestWorkoutTemplate(goal): возвращает один из 3–4 захардкоженных шаблонов
  recipes.ts        — listFavoriteRecipes(): читает data/recipes.md (создай с 5–6 рецептами)



## Требования
- Каждый tool: Zod-схема параметров + описание, понятное модели (описания пиши тщательно — это часть интерфейса).
- Tools подключаются только к Health Coach Agent. Safety Reviewer остаётся «чистым» — только текст плана на вход. Зафиксируй это комментарием: reviewer не должен иметь побочных эффектов.
- Обнови промпт коуча → healthCoach.v2.md: убери вставку файлов целиком, добавь инструкцию пользоваться tools. Переключи ACTIVE_PROMPTS.
- Harness собирает toolCalls: string[] (имена вызванных tools по порядку) и возвращает в результате; UI показывает список «Что сделал агент».
- savePlan вызывается агентом только после approve ревьюера — это контролирует harness, а не промпт (объясни в комментарии, почему).



## Запрещено
- Никаких MCP, внешних API, БД, embeddings.
- Не делать «универсальный tool-реестр» и плагинную систему — простой массив tools.
- Не давать tools ревьюеру.
- Не пиши тесты и TDD



## Definition of Done
- Запрос «план питания на завтра с учётом моего лога» → в toolCalls видны getProfile, getRecentLog; план учитывает данные.
- Запрос «составь список покупок к плану» → generateShoppingList вызван, data/shopping.md создан.
- В UI виден список tool calls.

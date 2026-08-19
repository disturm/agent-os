## Контекст
Next.js-приложение: страница с формой «задача → результат» (без чата и стриминга), POST /api/agent/run. Под капотом: Health Coach + Safety Reviewer, harness (loop до 3 раундов, traces, evals), MCP-слой, RAG-tool searchKnowledge, локальные tools. Результат запуска содержит rounds, toolCalls, finalScore, promptVersions, durationMs.



## Задача
Замени форму на чатовый интерфейс со стримингом и живыми статусами этапов.

1) Чат:
   - Vercel AI SDK (useChat или аналог) + стриминговый route handler app/api/chat/route.ts
   - история сообщений в состоянии страницы (без персиста)
   - финальный план стримится токен за токеном

2) Статусы этапов — до финального текста в чате появляются и обновляются шаги:
   1. Reading profile
   2. Searching knowledge (с текстом запроса, если был)
   3. Generating plan
   4. Reviewing safety (verdict + score по завершении)
   5. Revising (round N) — только если была ревизия
   6. Final approved plan
   Технически: harness эмитит события (onEvent-callback), route handler отправляет их в стрим как data-части, UI рендерит таймлайн.

3) Видимость tool calls: каждый tool call — строка таймлайна с иконкой источника ([mcp], [local], [rag]).

4) Safety-состояние: при needs_human_professional чат показывает карточку «Требуется специалист» с issues вместо плана.



## Требования
- runHealthAgent получает опциональный onEvent — существующий не-стриминговый API-роут и evals продолжают работать без изменений.
- Никаких UI-библиотек: аккуратный минимальный CSS, тёмная тема необязательна.
- Автоскролл чата, disabled-инпут во время выполнения.



## Запрещено
- Не переписывать harness — только добавить эмиссию событий.
- Никакого персиста истории чата (ни БД, ни localStorage).
- Никакой multi-conversation логики — один чат на странице.
- Не пиши тесты и TDD



## Definition of Done
- Задача в чате → таймлайн этапов оживает по мере работы → план стримится → внизу verdict/score.
- Ревизия (verdict revise) видна в таймлайне отдельным шагом.
- `npm run eval` работает как раньше.

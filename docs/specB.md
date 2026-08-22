Ты — senior TypeScript-разработчик. Принцип этапа: заменить учебные внутренности harness
на production-платформы, НЕ меняя его публичный API. Это апгрейд, а не переписывание.



## Контекст
Готовое приложение Agentic Wellness OS: Next.js, чатовый стриминговый UI с таймлайном;
router + 8 модулей-конфигураций поверх одного Health Coach Agent; Safety Reviewer;
harness (src/harness/: loop, validateReview с Zod, rounds, score, promptVersions —
промпты в prompts/*.md, traceRun — трейсы в runs/*.json); evals (npm run eval, 9 кейсов);
replay; MCP-слой (свой markdown-сервер + filesystem, weather, notion по конфигу);
RAG на Supabase pgvector. Модель — DeepSeek через OpenAI-compatible API (baseURL из .env).



## Задача
Три апгрейда, строго по очереди, с рабочим состоянием после каждого шага.

1) Model Gateway — OpenRouter:
   - переключи провайдера на OpenRouter (это OpenAI-compatible API: меняется baseURL,
     ключ и идентификаторы моделей в .env)
   - раздельные модели: AGENT_MODEL (недорогая генерация), REVIEWER_MODEL (строже),
     ROUTER_MODEL (самая дешёвая)
   - настрой fallback-модель для агента средствами OpenRouter
   - старый прямой DeepSeek-конфиг оставь закомментированным в .env.example с пометкой
     «учебный вариант»

2) Langfuse — поэтапно, с двойной записью:
   а) Развёртывание: docker-compose для self-host (или cloud-ключи из .env — поддержи оба
      варианта через LANGFUSE_HOST)
   б) Traces: traceRun.ts дополнительно отправляет запуск в Langfuse (спаны: раунды,
      tool calls с источником, retrieval, verdict, score, module, latency, cost).
      Локальные runs/*.json НЕ удаляются — двойная запись. Ошибка Langfuse не роняет запуск.
   в) Prompt Management: promptVersions.ts учится читать промпты из Langfuse по имени
      и label (production). Приоритет: Langfuse → локальный prompts/*.md как fallback.
      Залей текущие промпты в Langfuse скриптом npm run prompts:push.
   г) Evals: npm run eval после прогона пишет результаты (pass/fail, score) как scores
      в Langfuse, привязанные к трейсам.

3) Structured Outputs для ревьюера:
   - переведи Safety Reviewer на нативный JSON-режим провайдера (json_schema из Zod-схемы,
     конвертация через zod-to-json-schema)
   - validateReview.ts остаётся как страховка, но ретрай теперь почти не срабатывает —
     залогируй счётчик ретраев, чтобы показать разницу



## Требования
- Публичная сигнатура runHealthAgent / runOS не меняется. UI, evals, replay работают без правок.
- Все новые интеграции выключаемы: без LANGFUSE_* ключей всё работает как раньше, локально.
- README-раздел «Production Upgrade»: таблица «было (файл) → стало (платформа)».



## Запрещено
- Не переписывать harness и агентов — только реализации за существующими интерфейсами.
- Не удалять локальные механизмы (runs/*.json, prompts/*.md) — они fallback и учебный артефакт.
- Никакого Temporal, очередей, новых UI-экранов.
- Не подключать Langfuse SDK внутри агентов — только на уровне harness.



## Definition of Done
- Запуск из UI виден в Langfuse: дерево спанов с tool calls, verdict, score, cost, module.
- Меняю label версии промпта в Langfuse UI → следующий запуск ведёт себя иначе. Деплоя не было.
- npm run eval — результаты и scores видны в Langfuse, привязаны к трейсам.
- Удаляю LANGFUSE_* из .env → приложение работает полностью на локальных файлах.
- В трейсе ревьюера счётчик JSON-ретраев = 0 на 10 подряд запусках.

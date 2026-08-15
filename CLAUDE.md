# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Язык общения

Отвечай на русском языке, технические термины оставляй на английском (verdict, route handler, harness, revision loop, App Router, build). Не переводи имена файлов, функций, env-переменных и полей API.

## Команды

```bash
npm install
npm run dev                                        # Next.js dev server, http://localhost:3000
npm run build                                      # production build + typecheck (Turbopack)
npm run agent -- "составь план питания на завтра"   # тот же цикл из CLI, двойной дефис обязателен
npx tsc --noEmit                                   # только typecheck
```

Тестов в проекте нет и они не нужны: spec2 прямо запрещает тесты и TDD. Проверка изменений — ручной прогон через UI или `npm run agent`. Быстрая проверка предохранителя: задача «подбери мне лекарство от давления» должна дать `verdict=needs_human_professional`.

**Каждый прогон — платные вызовы DeepSeek** (минимум 2: coach + reviewer, до 6 при трёх раундах). Не гоняй полный цикл ради проверки, которую можно сделать через `npx tsc --noEmit`, `npm run build` или запрос с пустой задачей (`400`, модель не вызывается).

## Архитектура

Wellness-агент: **Health Coach** пишет план, **Safety Reviewer** его проверяет, оркестрация — в коде, а не в промпте. Инструментов и function calling у агентов нет, они работают только на контексте из markdown-файлов.

Поток: `app/page.tsx` → `POST /api/agent/run { task }` → `runHealthAgent(task)` → `{ plan, review: { verdict, score, issues }, rounds }`.

- `src/harness/runHealthAgent.ts` — единственное место с логикой. На module load поднимает DeepSeek через `setDefaultOpenAIClient` + `setOpenAIAPI('chat_completions')` (DeepSeek не умеет Responses API) и бросает, если нет `DEEPSEEK_API_KEY`. Внутри: сборка контекста из `data/profile.md` + `data/log.md` + задачи, revision loop до 3 раундов, запись `data/output.md` только на `approve`.
- `src/agents/*.ts` — по файлу на агента: системный промпт + инстанс `Agent`. Zod-схема ревью живёт рядом с ревьюером.
- `app/api/agent/run/route.ts` и `index.ts` — две тонкие обёртки над harness (HTTP и CLI). Логику в них не добавлять.

Вердикты ревьюера: `approve` → план сохранён; `revise` → issues уходят обратно коучу (после 3-го раунда возвращается как есть, `output.md` не пишется); `needs_human_professional` → остановка, UI показывает предупреждение вместо плана. Ревьюер обязан вернуть чистый JSON — парсинг вырезает содержимое между первой `{` и последней `}`, валидация через Zod, на невалидный ответ один retry, потом throw.

## Границы продукта

Это **не медицинский продукт**. Диагнозы, лекарства, БАДы, дозировки, анализы, лечение — запрещены на уровне обоих промптов. Ослаблять эти формулировки нельзя, `needs_human_professional` — предохранитель, а не edge case.

По spec2 приложение осознанно минимально: без стриминга, чата, истории сообщений, авторизации, БД и состояния между запросами. Одна задача — один ответ. Новые возможности агентам не добавлять без явной просьбы.

Промпты (`COACH_PROMPT`, `REVIEWER_PROMPT`) и логика loop перенесены из V0 дословно — правь их только по прямому запросу, а не «попутно» при рефакторинге.

## Подводные камни

- **Импорты внутри проекта — без расширения** (`'../agents/healthCoach'`). Turbopack не резолвит `.js` → `.ts`, `next dev` падает с `Module not found`.
- `data/*` читается через `join(process.cwd(), 'data', ...)`, то есть от корня проекта. Запускать команды из корня.
- `import 'dotenv/config'` нужен только в `index.ts` и должен идти первой строкой: harness читает env при загрузке модуля. Next подхватывает `.env` сам.
- `next.config.ts` существует ровно ради `agentRules: false` — иначе Next при каждом старте перезаписывает `AGENTS.md` и `CLAUDE.md` в корне.
- Файлов и папок сверх структуры из spec2 не создавать. Служебных исключений три: `app/layout.tsx`, `tsconfig.json`, `next.config.ts`.
- `data/output.md` в `.gitignore` — перезаписывается каждым одобренным прогоном.
- Модель по умолчанию `deepseek-v4-pro`, `DEEPSEEK_MODEL=deepseek-v4-flash` дешевле и для этой задачи достаточно.

## Тестирование

- При написании кода агентом не пиши тесты и не используй TDD

## Принципы кодовой базы

- Поддерживать кодовую базу в высокомодульном состоянии и с хорошей документацией
- Следовать принципу "разделения ответственности" (separation of cencerns)

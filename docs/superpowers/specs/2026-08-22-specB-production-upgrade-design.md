# specB: Production Upgrade — дизайн

- **Дата:** 2026-08-22
- **Источник требований:** [`docs/specB.md`](../../specB.md)
- **Статус:** одобрен пользователем, принят в реализацию
- **Принцип этапа:** заменить учебные внутренности harness на production-платформы, **не меняя его публичный API**. Это апгрейд, а не переписывание.

---

## 1. Решения, зафиксированные до реализации

| Вопрос | Решение | Почему |
|---|---|---|
| Имена переменных провайдера | Нейтральные `LLM_API_KEY` / `LLM_BASE_URL` | OpenRouter здесь — это baseURL, а не особый код. Закомментированный «учебный вариант» в `.env.example` становится рабочим: те же переменные, другие значения — раскомментировал и вернулся на прямой DeepSeek. |
| Развёртывание Langfuse | `docker-compose.yml` в корне + cloud через `LANGFUSE_BASE_URL` | Ровно то, что просит спека: поддержаны оба варианта одной переменной. Спека называет её `LANGFUSE_HOST`; переименована по ходу реализации в `LANGFUSE_BASE_URL` — под этим именем переменную читает сам SDK, и расхождение имён приводило бы к конфигу, работающему «через раз». |
| Объём Prompt Management | Только `coach` и `reviewer` | Приписки модулей (`prompts/modules/*.md`) по specA намеренно без версий, их история читается по git. DoD «поменял label → следующий запуск ведёт себя иначе» выполняется полностью и на двух промптах. |
| Нативный JSON у ревьюера | `response_format: json_schema` через `modelSettings.providerData` | `validateReview` остаётся ровно на своём месте — парсером-страховкой, и счётчик ретраев честно показывает 0. |
| Слой Langfuse | `@langfuse/client`, без OTEL | См. §2. |
| Конвертация Zod → JSON Schema | Встроенный `z.toJSONSchema` из zod v4 | В проекте `zod ^4.4.3`, конвертер уже внутри. Пакет `zod-to-json-schema` дал бы тот же результат ценой лишней зависимости. Отступление от буквы спеки, одобрено. |

## 2. Выбор слоя Langfuse

Актуальный SDK — scoped-пакеты `@langfuse/*` (v5, рерайт марта 2026). Рассмотрены три пути.

**A. `@langfuse/tracing` + `@langfuse/otel` + `@opentelemetry/sdk-trace-node`.** Канонический путь, но требует глобального tracer provider, поднятого до harness (в Next — `instrumentation.ts`). OTEL-спаны рассчитаны на живую инструментацию, а мы собираем дерево **постфактум**, из готовых данных прогона. Четыре зависимости и риск на Turbopack ради механики, которой мы не пользуемся.

**B. `@langfuse/client` и его `.api.ingestion.batch()`.** ← **выбрано.** Один пакет, ноль OTEL. Дерево наблюдений собирается явно, со своими `startTime`/`endTime`; промпты и scores — типизированными методами того же клиента (`.prompt.get()`, `.score.create()`). Работает одинаково в Next-роуте, CLI и скриптах; выключается одним `if`.

**C. Голый `fetch` по REST, как `src/rag/supabaseRest.ts`.** В духе репозитория, но пришлось бы своими руками воспроизводить формат ingestion и потерять кэш промптов с `cacheFallback`, который в B достаётся бесплатно.

## 3. Архитектура

### Шаг 1. Model Gateway — OpenRouter

`src/harness/provider.ts` остаётся единственным местом настройки провайдера и получает три раздельные модели:

- `AGENT_MODEL` — коуч и шаг фиксации,
- `REVIEWER_MODEL` — Safety Reviewer,
- `ROUTER_MODEL` — классификатор OS.

`src/agents/healthCoach.ts`, `src/agents/safetyReviewer.ts` и `src/os/router.ts` перестают читать env самостоятельно (сейчас `DEEPSEEK_MODEL` продублирован в трёх файлах) и импортируют константы отсюда. Побочный эффект: закрывается известный footgun «модуль зовёт модель, не импортировав `provider`» — импорт констант делает зависимость обязательной по типам, а не по дисциплине.

`MODEL` сохраняется как экспорт-алиас `AGENT_MODEL`: его ждут `scripts/replay.ts` и формат трейса.

Fallback-модель — `AGENT_FALLBACK_MODEL`, средствами OpenRouter: `modelSettings.providerData.models = [AGENT_MODEL, fallback]`. Только для коуча, как и просит спека. В `defaultHeaders` клиента уезжают `HTTP-Referer` и `X-Title` — OpenRouter их рекомендует.

**Дефолты сохраняют сегодняшнее поведение** (agent и reviewer — pro, router — flash). Спека хочет «agent недорогой, reviewer строже», но менять дефолтом класс модели у коуча — значит незаметно сдвинуть результаты всех evals. Рекомендованный сплит прописан комментарием в `.env.example` и включается одной строкой.

### Шаг 2. Langfuse

#### 2а. Наблюдения: `src/harness/observations.ts` (новый)

Harness **не переписывается** — к нему добавляется накопитель, ровно тем же приёмом, каким уже собираются `toolCalls` и `retrievals`: на каждый шаг пишется запись `{ name, type, round, startedAt, endedAt, input, output, model, usage }`. Про Langfuse модуль не знает вовсе — симметрично `runEvents.ts`, который не знает про AI SDK.

Прогон без Langfuse от этого не меняется ничем, кроме нескольких `push` в массив. На этом держится требование спеки, что UI, evals и replay работают без правок.

#### 2б. Отправка: `src/langfuse/` (новый каталог, зеркалит `src/rag/`)

- `client.ts` — единственное место, где решается «включён ли Langfuse» (`LANGFUSE_PUBLIC_KEY` + `LANGFUSE_SECRET_KEY`, хост из `LANGFUSE_BASE_URL`). Env читается **лениво, на вызов**, а не на загрузке модуля: иначе импорт уронит роут — это уже пройденные грабли `src/rag/`.
- `runTrace.ts` — превращает наблюдения в дерево и шлёт батчем. Не бросает никогда.
- `prompts.ts` — `fetchPrompt(name, label)` с `cacheFallback`.
- `scores.ts` — scores для evals.

Дерево наблюдений:

```
trace  (task → plan; metadata: module, intentConfidence, promptVersions,
        finalRound, verdict, score, reviewRetries; tags: [module, verdict])
├── round-1
│   ├── generation coach     (model=AGENT_MODEL, usage)
│   ├── span      tool call  (имя с источником: [weather] weather_forecast)
│   ├── span      retrieval  (query → headings)
│   └── generation reviewer  (model=REVIEWER_MODEL, usage, output=вердикт)
├── round-2 …
└── span save-plan
```

`traceRun.ts` становится `async` и после локальной записи зовёт `runTrace`. **Локальный JSON не трогается** — это двойная запись; в него добавляется только `langfuseTraceId`, чтобы файл и платформа сходились. Ошибка Langfuse запуск не роняет — по той же причине, по которой его не роняет сбой записи трейса: прогон к этому моменту уже оплачен.

`traceId` генерится в `finish()` и уезжает в `AgentResult.traceId?` — так evals привязывают scores. Поля только добавляются; сигнатуры `runHealthAgent` и `runOS` те же.

**Cost.** У OpenRouter запрашивается `usage: { include: true }`, ответ содержит фактическую стоимость, и она уезжает в Langfuse явными `costDetails`. Если Agents SDK не пропустит провайдерские extras сквозь нормализованный `usage` — откат на «модель + токены, стоимость считает Langfuse». Проверяется живым прогоном, а не на глаз.

#### 2в. Prompt Management: `promptVersions.ts`

Появляется async `resolvePrompt(role)` → `{ text, version, source }`. Приоритет: **Langfuse → локальный `prompts/*.md`**. Синхронные `loadPrompt` / `loadActivePrompt` остаются нетронутыми — они и есть fallback.

В `PromptVersions` (а значит в трейс и в replay) уезжает `langfuse:7` против прежнего `v6`. Формат поля прежний — строка, поэтому replay и старые трейсы продолжают читаться.

Модульные приписки остаются файлами. `scripts/promptsPush.ts` + `npm run prompts:push` заливает активные версии в Langfuse под label `production`; флаг `--dry` печатает, что уехало бы, не трогая сеть — по образцу `npm run ingest -- --dry`.

#### 2г. Evals

`scripts/eval.ts` после каждого кейса пишет два score, привязанных к `traceId` прогона: `eval-passed` (boolean) и `eval-score` (numeric 0–10), в `comment` — причина FAIL. Без ключей Langfuse шаг молча пропускается.

### Шаг 3. Structured Outputs для ревьюера

`validateReview.ts` дополнительно экспортирует `REVIEW_RESPONSE_FORMAT` — это по-прежнему «форма ответа ревьюера», его зона ответственности. `createReviewer` ставит его в `modelSettings.providerData.response_format`.

Парсер и политика ретрая остаются нетронутой страховкой. `validateReview` начинает возвращать `{ review, retries }`; harness суммирует их в `reviewRetries` — в лог и в трейс. DoD: на 10 подряд прогонах счётчик = 0.

## 4. Новые файлы

| Файл | Ответственность |
|---|---|
| `docker-compose.yml` | Self-host стек Langfuse. Web на **3001** — 3000 занят `next dev`. |
| `src/harness/observations.ts` | Накопитель наблюдений прогона. Про Langfuse не знает. |
| `src/langfuse/client.ts` | Клиент и правило включения. Env читается лениво. |
| `src/langfuse/runTrace.ts` | Наблюдения → дерево → батч. Не бросает. |
| `src/langfuse/prompts.ts` | Промпт по имени и label, с фолбэком. |
| `src/langfuse/scores.ts` | Scores для evals. |
| `scripts/promptsPush.ts` | `npm run prompts:push`, с `--dry`. |

## 5. Правки существующих файлов

| Файл | Что меняется |
|---|---|
| `src/harness/provider.ts` | Три модели, нейтральные env, заголовки OpenRouter. |
| `src/agents/healthCoach.ts` | Модель из `provider`, fallback через `providerData`. |
| `src/agents/safetyReviewer.ts` | Модель из `provider`, `response_format`. |
| `src/os/router.ts` | `ROUTER_MODEL` из `provider`. |
| `src/harness/validateReview.ts` | `REVIEW_RESPONSE_FORMAT`, возврат `{ review, retries }`. |
| `src/harness/runHealthAgent.ts` | Сбор наблюдений, `reviewRetries`, `traceId`, `await saveTrace`. |
| `src/harness/promptVersions.ts` | `resolvePrompt` с приоритетом Langfuse. |
| `src/harness/traceRun.ts` | `async`, отправка в Langfuse, поле `langfuseTraceId`. |
| `src/os/runOS.ts` | `coachPromptFor` становится async. |
| `scripts/eval.ts` | Scores в Langfuse. |
| `.env.example`, `README.md`, `CLAUDE.md`, `package.json` | Переменные, раздел «Production Upgrade», документация, скрипт. |

## 6. Границы (что этот этап НЕ делает)

- Harness и агенты не переписываются — меняются только реализации за существующими интерфейсами.
- Локальные механизмы не удаляются: `runs/*.json` и `prompts/*.md` остаются fallback-ом и учебным артефактом.
- Никакого Temporal, очередей, новых UI-экранов.
- Langfuse SDK не подключается внутри агентов — только на уровне harness.
- Публичные сигнатуры `runHealthAgent` / `runOS` не меняются; поля результата только добавляются.
- Без `LANGFUSE_*` приложение работает полностью на локальных файлах.
- Инварианты specA держатся: Safety Reviewer обязателен для каждого модуля, необратимые инструменты выдаются только после `approve`.

## 7. Проверка

**Бесплатно** (модель не вызывается):

- `npx tsc --noEmit`, `npm run build`;
- `npm run prompts:push -- --dry`;
- `runTrace` из временного скрипта на синтетических наблюдениях — дерево уезжает в Langfuse без единого вызова модели;
- запрос с пустой задачей (`400`).

**Платно** (запускает пользователь, по слову):

- живой прогон из UI → дерево спанов с tool calls, verdict, score, cost, module;
- смена label промпта в Langfuse UI → следующий запуск ведёт себя иначе, без деплоя;
- `npm run eval` → scores привязаны к трейсам (~10 циклов, 50+ вызовов);
- 10 подряд прогонов → счётчик JSON-ретраев ревьюера = 0.

## 8. Риски

| Риск | Смягчение |
|---|---|
| Agents SDK нормализует `usage` и теряет `cost` от OpenRouter | Откат на «модель + токены», стоимость считает Langfuse по своему прайсу. |
| `response_format` не поддержан выбранной моделью на OpenRouter | `validateReview` остаётся страховкой — ровно для этого. Счётчик ретраев покажет проблему сразу. |
| Асинхронный `resolvePrompt` тянет `async` вверх по цепочке | Все три вызывающих места уже внутри `async`-функций. |
| Отправка трейса добавляет задержку в хвост прогона | Один HTTP-запрос на фоне минутного прогона. Awaited намеренно: fire-and-forget в Next-роуте не успел бы уйти. |

## 9. Порядок реализации

Три шага строго по очереди, с рабочим состоянием после каждого — как требует спека. После каждого шага: `npx tsc --noEmit` и `npm run build`.

1. Model Gateway.
2. Langfuse: наблюдения → traces → prompts → eval scores.
3. Structured Outputs.

Документация (`README.md` «Production Upgrade», `CLAUDE.md`) — последним шагом, когда фактическое устройство зафиксировано.

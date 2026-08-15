## Контекст
В репозитории Next.js-приложение: страница с формой (app/page.tsx), POST /api/agent/run, агенты src/agents/healthCoach.ts и src/agents/safetyReviewer.ts, loop в src/harness/runHealthAgent.ts, данные в data/*.md. Loop: коуч → ревьюер (JSON verdict/score/issues через Zod) → до 3 ревизий.



## Задача
Преврати runHealthAgent из «скрипта с циклом» в настоящий harness — слой контроля вокруг агента. Разбей на модули:



src/harness/
  runHealthAgent.ts    — оркестратор: собирает всё вместе, публичный API не меняется
  validateReview.ts    — Zod-схема ревью + safe-parse с одним ретраем
  rounds.ts            — состояние раундов: RoundState { round, plan, review }, история всех раундов
  score.ts             — подсчёт итогового score (последний approve) и флага improved (вырос ли score между раундами)
  promptVersions.ts    — загрузка промптов из файлов



prompts/
  healthCoach.v1.md
  safetyReviewer.v1.md



## Требования
- Промпты агентов переезжают из кода в prompts/*.v1.md. promptVersions.ts читает файл по имени и версии; активная версия задаётся константой ACTIVE_PROMPTS = { coach: "v1", reviewer: "v1" }.
- runHealthAgent возвращает расширенный результат: { plan, review, rounds: RoundState[], finalScore, promptVersions, durationMs }.
- maxRounds — параметр функции с дефолтом 3.
- API-роут и UI дополняются: показать durationMs, версии промптов и историю раундов (свёрнутый список: round N — verdict — score).
- Каждый модуль — одна ответственность, без общих utils-свалок.



## Запрещено
- Не сохранять ничего на диск, кроме output.md (персистентность трейсов — не сейчас).
- Никаких evals, replay, БД, внешних сервисов.
- Не менять поведение агентов и тексты промптов — только перенос в файлы.
- Не пиши тесты и tdd



## Definition of Done
- Полный цикл работает как раньше, но результат содержит rounds, finalScore, promptVersions, durationMs.
- Создание healthCoach.v2.md и смена ACTIVE_PROMPTS меняет поведение без правок кода.

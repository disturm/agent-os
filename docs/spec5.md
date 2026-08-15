## Контекст
Next.js-приложение: harness (src/harness/: runHealthAgent, validateReview, rounds, score, promptVersions), агенты с tools (src/skills/: profile, logs, plans, shopping, workouts, recipes), промпты версионируются в prompts/. Результат запуска уже содержит rounds, toolCalls, finalScore, promptVersions, durationMs — но всё живёт только в ответе API.



## Задача
Добавь персистентные трейсы, replay и мини-evals.

1) Traces — src/harness/traceRun.ts:
   - после каждого запуска сохраняет runs/run-<timestamp>.json
   - содержимое: { runId, task, promptVersions, model, rounds: [{ round, planExcerpt (первые 500 символов), review }], toolCalls, finalScore, verdict, durationMs, createdAt }
   - runs/ добавь в .gitignore, но положи один run-example.json в репо

2) Replay — scripts/replay.ts:
   - `npm run replay runs/run-XXX.json`
   - берёт task из трейса, прогоняет через текущий runHealthAgent, печатает сравнение: старый vs новый (verdict, score, раунды, toolCalls, promptVersions)
   - смысл: видно, что изменилось после правки промпта или модели

3) Evals — evals/cases/*.json + scripts/eval.ts:
   - 5 кейсов: low-energy.json, travel-day.json, no-gym.json, bad-medical-request.json, chaotic-nutrition.json
   - формат кейса: { name, task, expect: { verdict: "approve" | "needs_human_professional", minScore?: number } }
   - `npm run eval` прогоняет все кейсы последовательно, печатает таблицу PASS/FAIL
   - bad-medical-request обязан ожидать needs_human_professional — это тест safety gate



## Требования
- traceRun вызывается из harness автоматически, ошибка записи трейса не роняет запуск.
- Все скрипты — на tsx, без сборки.
- В README короткий раздел «Как дебажить агента»: trace → replay → eval.



## Запрещено
- Никаких Langfuse, OpenTelemetry, внешних сервисов — только локальные JSON.
- Никаких параллельных прогонов, воркеров, очередей.
- Не превращать evals в фреймворк: один скрипт, простой цикл.
- Не пиши тесты и не используй TDD



## Definition of Done
- Каждый запуск из UI создаёт файл в runs/.
- replay показывает diff двух прогонов одной задачи.
- `npm run eval` — 5 кейсов, bad-medical-request проходит только при остановке агента.

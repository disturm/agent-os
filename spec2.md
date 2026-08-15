## Контекст

В репозитории уже есть рабочий локальный агент: index.ts (Health Coach Agent + Safety Reviewer Agent с revision loop до 3 раундов, оркестрация в коде), profile.md, log.md, output.md. Стек: TypeScript, OpenAI Agents SDK, DeepSeek через OpenAI-compatible API, Zod.



## Задача
Преврати CLI-скрипт в простое Next.js-приложение, ничего не меняя в логике агентов.



## Целевая структура
app/page.tsx                    — страница: textarea для задачи, кнопка Run Agent, блок результата
app/api/agent/run/route.ts      — POST-эндпоинт, вызывает harness
src/agents/healthCoach.ts       — агент-коуч (вынесен из index.ts)
src/agents/safetyReviewer.ts    — агент-ревьюер (вынесен из index.ts)
src/harness/runHealthAgent.ts   — функция runHealthAgent(task): весь loop из index.ts
data/profile.md
data/log.md
data/output.md



## Флоу
Пользователь вводит задачу → POST /api/agent/run { task } → runHealthAgent → ответ { plan, review: { verdict, score, issues }, rounds } → UI показывает план и результат safety review.



## Требования
- Next.js App Router
- UI показывает три состояния: idle / running (простой текст «Агент работает…») / result.
- В блоке результата: финальный план, verdict, score, список issues, количество раундов.
- Если verdict = needs_human_professional — показать заметное предупреждение «Этот запрос требует консультации специалиста», план не показывать.
- Рефакторинг = перенос кода, не переписывание: промпты и логика loop остаются идентичными V0.



## Запрещено
- Никакого стриминга, чата, истории сообщений — одна задача, один ответ.
- Никакой авторизации, БД, состояния между запросами.
- Не добавлять новые возможности агентам.
- Не создавать файлы и папки сверх целевой структуры.
- Не пиши тесты и не используй TDD



## Definition of Done
- `npm run dev`, ввод задачи в UI, полный цикл работает, output.md обновляется.
- Старый index.ts удалён или превращён в тонкий CLI-враппер над runHealthAgent (одно из двух, выбери и объясни в README).



## Дополнение: UI-слой на shadcn/ui

Принято отдельным решением после сдачи spec2. Запрет «не создавать файлы и папки сверх целевой структуры» **не распространяется** на слой представления: shadcn/ui — генератор, он держит исходники компонентов в репозитории, без своих файлов не существует.

Разрешённые файлы сверх целевой структуры:

```
components.json                          — конфиг shadcn (написан руками, init не запускать)
postcss.config.mjs                       — @tailwindcss/postcss
app/globals.css                          — Tailwind v4, переменные темы
lib/utils.ts                             — cn()
lib/agent-result.ts                      — типы ответа API и оформление вердиктов
components/ui/*.tsx                       — примитивы shadcn
components/AgentForm|ReviewPanel|PlanView|ThemeToggle.tsx — компоненты экрана
```

Границы дополнения:

- Меняется только представление. `src/`, `app/api/agent/run/route.ts`, `index.ts`, промпты и revision loop не трогаются.
- Остальные запреты spec2 в силе: ни стриминга, ни чата, ни истории, ни авторизации, ни БД, ни состояния между запросами. Одна задача — один ответ.
- Предохранитель не ослабляется: при `verdict=needs_human_professional` план не рендерится вообще, вместо него предупреждение.
- Тесты по-прежнему не пишутся.

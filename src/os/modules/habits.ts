/**
 * Модуль «Привычки»: трекер, регулярность, серии и срывы (`docs/specA.md`).
 *
 * Единственный модуль, которому достаются `read_habits` и `check_habit`. Второй пишет
 * в `data/habits.md`, и это осознанное исключение из «всё пишущее — после approve»:
 * отметка идемпотентна, ничего не перезаписывает и фиксирует не план, а факт, о котором
 * сказал сам пользователь («сегодня лёг до полуночи»). Артефакты плана — `output.md`,
 * `plans/`, Notion — по-прежнему только в `approvedTools` (см. `servers.config.ts`).
 */

import type { OsModule } from './index';

export const habits: OsModule = {
  name: 'habits',
  description:
    'Привычки и регулярность: трекер, серии, срывы, отметки о выполнении. ' +
    'Сюда идут «как я держу режим», «отметь, что я сегодня тренировался», «почему бросаю через неделю».',
  promptFile: 'habits.md',
  tools: ['read_profile', 'read_recent_logs', 'searchKnowledge', 'read_habits', 'check_habit'],
};

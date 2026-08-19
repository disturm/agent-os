/**
 * Модуль «План дня»: целый день целиком — еда, активность, восстановление, режим.
 *
 * Самый широкий из специализированных, поэтому набор у него полный: день задевает всё
 * сразу, и отрезать здесь нечего. Специализация — не в инструментах, а в промпте:
 * связать разделы между собой и разложить их по часам.
 */

import type { OsModule } from './index';

export const dailyPlan: OsModule = {
  name: 'dailyPlan',
  description:
    'План на день или на завтра целиком: распорядок, еда, активность и восстановление вместе. ' +
    'Сюда идут «составь план на завтра», «распиши мой день», «план на выходной».',
  promptFile: 'dailyPlan.md',
  tools: [
    'read_profile',
    'read_recent_logs',
    'list_recipes',
    'searchKnowledge',
    'geocoding',
    'weather_forecast',
    'suggestWorkoutTemplate',
  ],
};

/**
 * Модуль «Тренировки»: занятие или неделя занятий, упражнения, объём, интенсивность.
 *
 * Погода в наборе есть и не случайно: уличная часть тренировки от прогноза зависит
 * напрямую, и правило переноса в зал живёт в базовом промпте коуча.
 */

import type { OsModule } from './index';

export const training: OsModule = {
  name: 'training',
  description:
    'Тренировки и нагрузка: какие упражнения, сколько подходов, как часто, зал или улица. ' +
    'Сюда идут «составь тренировку», «программа на неделю», «чем заменить приседания».',
  promptFile: 'training.md',
  tools: [
    'read_profile',
    'read_recent_logs',
    'searchKnowledge',
    'suggestWorkoutTemplate',
    'geocoding',
    'weather_forecast',
  ],
};

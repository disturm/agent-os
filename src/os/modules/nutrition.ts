/**
 * Модуль «Питание»: рацион, приёмы пищи, белок и калории, перекусы, вода.
 *
 * Погоды и шаблонов тренировок здесь нет намеренно: рацион от прогноза не зависит,
 * а лишний инструмент в наборе — это лишний повод модели сходить не туда.
 */

import type { OsModule } from './index';

export const nutrition: OsModule = {
  name: 'nutrition',
  description:
    'Питание и рацион: сколько есть, что и когда, белок, калории, перекусы, вода, тяга на сладкое. ' +
    'Сюда идут «наладь питание», «сколько мне белка», «что не так с моим рационом».',
  promptFile: 'nutrition.md',
  tools: ['read_profile', 'read_recent_logs', 'list_recipes', 'searchKnowledge', 'generateShoppingList'],
};

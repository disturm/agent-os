/**
 * Модуль «Список покупок»: продукты на день или на неделю.
 *
 * `generateShoppingList` разбирает готовый текст плана, поэтому план здесь всё равно
 * пишется целиком — список это его следствие, а не замена. Дневника в наборе нет:
 * что покупать, решают ограничения из профиля и то, что человек умеет готовить.
 */

import type { OsModule } from './index';

export const shoppingList: OsModule = {
  name: 'shoppingList',
  description:
    'Список покупок: что купить на день или на неделю, продукты под план питания. ' +
    'Сюда идут «собери список покупок», «что купить на неделю», «список в магазин».',
  promptFile: 'shoppingList.md',
  tools: ['read_profile', 'list_recipes', 'searchKnowledge', 'generateShoppingList'],
};

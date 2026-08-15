/**
 * Skill: любимые рецепты пользователя.
 *
 * `data/recipes.md` — такой же ручной файл, как профиль и дневник: что человек уже готовит
 * и повторит без сопротивления. Модуль только отдаёт его содержимое; выбирать блюда
 * под задачу — дело агента.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tool } from '@openai/agents';
import { z } from 'zod';

export const listFavoriteRecipes = tool({
  name: 'listFavoriteRecipes',
  description: [
    'Возвращает список блюд, которые пользователь уже готовит: время приготовления, продукты,',
    'краткий способ и теги (завтрак, ужин, белок, быстро).',
    'Вызывай, когда планируешь еду: знакомое блюдо человек приготовит охотнее нового.',
    'Ограничения по продуктам всё равно проверяй по getProfile — список рецептов их не дублирует.',
    'Параметров нет, файл за прогон не меняется.',
  ].join(' '),
  parameters: z.object({}),
  execute: async () => readFileSync(join(process.cwd(), 'data', 'recipes.md'), 'utf8'),
});

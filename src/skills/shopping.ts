/**
 * Skill: список покупок по готовому плану.
 *
 * Разбор плана здесь намеренно тупой — регулярки, а не вторая модель: по spec4 внешних
 * вызовов у навыка быть не должно, а «достать продукты из своего же текста» агент умеет
 * и сам. Ценность инструмента в другом: результат ложится в `data/shopping.md` в едином
 * формате, а не растворяется в ответе.
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tool } from '@openai/agents';
import { z } from 'zod';

/** Разделы, в которых имеет смысл искать продукты. Не нашлись — читаем план целиком. */
const FOOD_HEADING = /^##+\s.*(питани|еда|меню|рацион)/i;
/** Строка списка: `- `, `* `, `1. ` — план приходит markdown-ом, продукты живут в пунктах. */
const BULLET = /^\s*(?:[-*+]|\d+[.)])\s+/;
/** Подпись приёма пищи в начале пункта: «08:30 Завтрак:», «Обед —». Ищем в первых 40 символах. */
const LABEL_SEPARATORS = [':', '—', '–'];
/**
 * Количества и единицы: в списке покупок они мешают, объёмы всё равно смотрят в плане.
 * Хвост — не `\b`, а «дальше не буква»: иначе «2 горсти» превращается в «орсти»,
 * потому что `г` из «горсти» сходит за граммы.
 */
const QUANTITY = /\b\d+(?:[.,]\d+)?\s*(?:г|гр|кг|мл|л|шт|ккал|ст\.?\s?л\.?|ч\.?\s?л\.?)?\.?(?![а-яёa-z])/gi;
/** Слова-заполнители, которые в магазине ничего не значат. */
const NOT_A_PRODUCT = /^(по вкусу|опционально|при желании|всего|итого)$/i;

/** Куски пункта, каждый из которых претендует на отдельную позицию списка. */
function splitProducts(line: string): string[] {
  const clean = line.replace(BULLET, '').replace(/[*_`]/g, '').replace(/\([^)]*\)/g, ' ');

  // Отрезаем подпись приёма пищи по последнему разделителю в начале строки:
  // в «08:30 Завтрак: омлет» первый `:` стоит внутри времени, а нужен тот, что после «Завтрак».
  const head = clean.slice(0, 40);
  const cut = Math.max(...LABEL_SEPARATORS.map((sep) => head.lastIndexOf(sep)));
  const body = cut === -1 ? clean : clean.slice(cut + 1);

  return body.split(/[,;]|\s\+\s|\sи\s/);
}

function normalize(fragment: string): string {
  return fragment
    .replace(QUANTITY, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-–—.,:;]+|[\s\-–—.,:;]+$/g, '');
}

/** Продукты из плана без повторов, в порядке появления. */
function extractProducts(planMarkdown: string): string[] {
  const sections = planMarkdown.split(/\n(?=##)/);
  const food = sections.filter((section) => FOOD_HEADING.test(section));
  const source = food.length > 0 ? food.join('\n') : planMarkdown;

  const seen = new Map<string, string>();
  for (const line of source.split('\n')) {
    if (!BULLET.test(line)) continue;
    for (const fragment of splitProducts(line)) {
      const product = normalize(fragment);
      if (product.length < 3 || product.length > 40) continue;
      if (!/[а-яёa-z]/i.test(product) || NOT_A_PRODUCT.test(product)) continue;
      const key = product.toLowerCase();
      if (!seen.has(key)) seen.set(key, product);
    }
  }
  return [...seen.values()];
}

export const generateShoppingList = tool({
  name: 'generateShoppingList',
  description: [
    'Собирает список покупок из готового плана питания и записывает его в data/shopping.md',
    'как markdown-чеклист, перезаписывая прежний список.',
    'Вызывай, когда просят список покупок, продукты к плану или «что купить».',
    'Передавай план целиком, вместе с заголовками разделов: продукты берутся из пунктов раздела про питание.',
    'Разбор текстовый и грубый — количества отбрасываются, поэтому позиции стоит перепроверить глазами.',
    'Возвращает ok, число позиций и сам список.',
  ].join(' '),
  parameters: z.object({
    planMarkdown: z
      .string()
      .min(1)
      .describe('Полный markdown плана, из которого берутся продукты. Не список продуктов и не пересказ.'),
  }),
  execute: async ({ planMarkdown }) => {
    const products = extractProducts(planMarkdown);
    if (products.length === 0) {
      return 'Продукты в тексте не нашлись, файл не тронут. Проверь, что передан весь план с разделом про питание.';
    }

    const file = [
      '# Список покупок',
      '',
      `Собрано из плана автоматически, позиций: ${products.length}. Количества смотрите в самом плане.`,
      '',
      ...products.map((product) => `- [ ] ${product}`),
      '',
    ].join('\n');
    writeFileSync(join(process.cwd(), 'data', 'shopping.md'), file, 'utf8');

    return `ok: ${products.length} позиций записано в data/shopping.md\n${products.map((p) => `- ${p}`).join('\n')}`;
  },
});

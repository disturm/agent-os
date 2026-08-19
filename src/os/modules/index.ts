/**
 * Каталог модулей OS: что такое модуль и какие они есть (`docs/specA.md`).
 *
 * Модуль — это **конфигурация поверх существующего агента**, а не второй агент: тот же
 * Health Coach, тот же revision loop, тот же Safety Reviewer. Меняются ровно две вещи —
 * текст специализации, дописываемый к промпту коуча, и набор черновых инструментов.
 * Никаких handoffs, подагентов и оркестрации между модулями в проекте нет и быть не должно.
 *
 * **Инвариант системы: Safety Reviewer обязателен для каждого модуля.** Ни один модуль не
 * может его отключить, ослабить или подменить — ревьюер живёт в `runHealthAgent`, вне
 * конфигурации модуля, и модулю его просто нечем достать. Здесь нет и не появится поля
 * вроде `skipReview`. Закреплено кейсами `evals/cases/module-*.json`.
 *
 * Реестр — простой массив, ровно как локальные инструменты в `healthCoach.ts`: класса
 * `ModuleRegistry` тут не нужно, модуль добавляется файлом рядом и строкой в `MODULES`.
 */

import { dailyPlan } from './dailyPlan';
import { habits } from './habits';
import { knowledge } from './knowledge';
import { nutrition } from './nutrition';
import { recipes } from './recipes';
import { recovery } from './recovery';
import { shoppingList } from './shoppingList';
import { training } from './training';

export type OsModule = {
  /** Имя модуля. Оно же уезжает роутеру, в событие таймлайна и в трейс. */
  name: string;
  /**
   * Одна-две фразы для роутера: по ним, и только по ним, он выбирает модуль.
   * Это часть промпта классификации, а не комментарий, — правится осознанно.
   */
  description: string;
  /**
   * Файл специализации в `prompts/modules/`. Дописывается к активному промпту коуча,
   * а не заменяет его: запреты, формат плана и правила сохранения живут в одном месте
   * (`prompts/healthCoach.v6.md`), и дублировать их по восьми файлам нельзя.
   *
   * `null` только у `general` — там специализации нет вовсе.
   */
  promptFile: string | null;
  /**
   * Черновые инструменты модуля, по именам. Список закрытый: имени, которого нет в наборе
   * прогона, достаточно, чтобы уронить сборку агента до первого платного вызова
   * (см. `createCoach`). Набор шага фиксации модулем не сужается — им распоряжается harness.
   */
  tools: string[];
};

/** Все специализированные модули. Порядок — тот, в каком они уходят в промпт роутера. */
export const MODULES: OsModule[] = [
  dailyPlan,
  nutrition,
  recipes,
  training,
  recovery,
  habits,
  shoppingList,
  knowledge,
];

/**
 * Модуль без специализации: то, чем прогон был до появления OS.
 *
 * Сюда попадает всё, в чём роутер не уверен (`confidence` ниже порога) и всё, чего он не
 * узнал. Промпта у него нет — работает активная версия коуча как есть; инструменты
 * перечислены явно, а не «все подряд», потому что «все» со временем перестанут совпадать
 * с тем, что было до OS: `check_habit` пишет в трекер и общей задаче не нужен.
 *
 * В `MODULES` он не входит: роутеру его не предлагают, к нему сваливаются.
 */
export const GENERAL: OsModule = {
  name: 'general',
  description: 'Общая задача без специализации: текущее поведение коуча.',
  promptFile: null,
  tools: [
    'read_profile',
    'read_recent_logs',
    'list_recipes',
    'searchKnowledge',
    'geocoding',
    'weather_forecast',
    'suggestWorkoutTemplate',
    'generateShoppingList',
  ],
};

/** Модуль по имени. Неизвестное имя — не ошибка: роутер мог придумать своё, и это `general`. */
export function findModule(name: string): OsModule {
  return MODULES.find((module) => module.name === name) ?? GENERAL;
}

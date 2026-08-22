/**
 * OS-флоу: единственная точка входа продукта (`docs/specA.md`).
 *
 *   задача → classifyIntent → выбор модуля → runHealthAgent с промптом и набором модуля
 *          → Safety Reviewer (без изменений, для всех модулей) → сохранение → обновление памяти
 *
 * Обёртка, а не второй оркестратор: цикл, ревью, метрики и трейс остались в
 * `runHealthAgent`. OS добавляет к ним ровно три вещи — выбор конфигурации до прогона,
 * метку маршрутизации в трейс и шаг обновления памяти после одобрения.
 *
 * **Инвариант: Safety Reviewer обязателен для каждого модуля.** Модуль умеет менять только
 * промпт коуча и набор его инструментов; ревьюер живёт внутри `runHealthAgent`, снаружи его
 * не выключить и не подменить — здесь нет и не должно появиться флага, который бы это менял.
 * Закреплено кейсами `evals/cases/module-*.json`.
 *
 * Мультиагентной оркестрации здесь тоже нет: ни handoffs, ни подагентов, ни диспетчера.
 * Один агент, восемь конфигураций и девятая — её отсутствие (`general`).
 */

import { loadModulePrompt, resolvePrompt } from '../harness/promptVersions';
import { runHealthAgent, type AgentResult, type RunOptions } from '../harness/runHealthAgent';
import { updateMemory } from './memory';
import { classifyIntent } from './router';
import type { OsModule } from './modules';

export type OsResult = AgentResult & {
  /** Имя модуля, под которым шёл прогон. `general` — специализации не было. */
  module: string;
  /** Уверенность роутера, 0…1. */
  intentConfidence: number;
};

/** `runHealthAgent` минус то, чем распоряжается сама OS. */
export type OsRunOptions = Omit<RunOptions, 'coachInstructions' | 'draftTools' | 'routing' | 'afterApprove'>;

/**
 * Промпт коуча для модуля: активная версия плюс специализация.
 *
 * Дописывание, а не замена: запреты (диагнозы, лекарства, дозировки), формат плана и правила
 * сохранения живут в базовом промпте коуча в единственном экземпляре. Разложить их по восьми
 * файлам модулей значило бы получить восемь редакций одного предохранителя, которые
 * разъедутся на первой же правке.
 *
 * Базовая часть с `docs/specB.md` берётся через `resolvePrompt` — то есть из Langfuse, если он
 * включён. Иначе смена label меняла бы поведение только у `general`, а у восьми модулей нет:
 * они бы продолжали дописываться к старому файлу. Приписки модулей остаются файлами
 * намеренно (`docs/specA.md`): версий у них нет, история читается по git.
 *
 * Промпт коуча за прогон резолвится дважды — здесь и в `runHealthAgent` (ему нужны версия
 * для трейса и базовый текст для шага фиксации). Второе обращение бесплатно: клиент Langfuse
 * кэширует промпты, а без Langfuse это чтение файла.
 */
async function coachPromptFor(module: OsModule): Promise<string | undefined> {
  if (!module.promptFile) return undefined; // general: активная версия как есть
  const base = await resolvePrompt('coach');
  return `${base.text}\n\n${loadModulePrompt(module.promptFile)}`;
}

/**
 * Прогон под управлением OS.
 *
 * Классификация идёт до `runHealthAgent`, потому что её результат — часть конфигурации
 * прогона: промпт и набор инструментов. Это один дешёвый вызов сверх обычного цикла.
 */
export async function runOS(task: string, options: OsRunOptions = {}): Promise<OsResult> {
  const { module, confidence, observation } = await classifyIntent(task);
  console.log(`Модуль: ${module.name} (confidence ${confidence.toFixed(2)}), инструментов ${module.tools.length}`);
  options.onEvent?.({ type: 'module', module: module.name, confidence });

  const result = await runHealthAgent(task, {
    ...options,
    coachInstructions: await coachPromptFor(module),
    draftTools: module.tools,
    routing: { module: module.name, intentConfidence: confidence },
    // Классификация случилась до прогона, и наблюдать её harness не мог. Без этой записи
    // сумма по дереву занижена на стоимость вызова роутера — дёшево, но неверно.
    priorObservations: [observation],
    // Память обновляется только после approve — момент выбирает harness, содержимое записи — OS.
    afterApprove: ({ plan, callTool }) => updateMemory({ task, plan, module: module.name, callTool }),
  });

  return { ...result, module: module.name, intentConfidence: confidence };
}

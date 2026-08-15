import { Agent } from '@openai/agents';
import { getProfile } from '../skills/profile';
import { getRecentLog } from '../skills/logs';
import { listFavoriteRecipes } from '../skills/recipes';
import { savePlan } from '../skills/plans';
import { generateShoppingList } from '../skills/shopping';
import { suggestWorkoutTemplate } from '../skills/workouts';

const MODEL = process.env.DEEPSEEK_MODEL ?? 'deepseek-v4-pro';

/**
 * Инструменты этапа черновика: агент сам достаёт данные и считает производные артефакты.
 * `savePlan` сюда не входит — записать итог можно только с разрешения harness (см. ниже).
 */
const DRAFT_TOOLS = [getProfile, getRecentLog, listFavoriteRecipes, suggestWorkoutTemplate, generateShoppingList];

/**
 * Health Coach: пишет wellness-план под задачу.
 *
 * Системный промпт живёт в `prompts/healthCoach.<версия>.md` — сюда он приходит
 * готовым текстом, версию выбирает harness (`promptVersions.ts`). Профиль и дневник
 * в промпт больше не подставляются: агент берёт их инструментами, когда сочтёт нужным.
 */
export function createCoach(instructions: string) {
  return new Agent({ name: 'Health Coach', model: MODEL, instructions, tools: DRAFT_TOOLS });
}

/**
 * Тот же коуч на шаге фиксации итога: единственный доступный инструмент — `savePlan`.
 *
 * Отдельная сборка агента, а не флаг в промпте, потому что «сохраняй только после одобрения» —
 * просьба, а не гарантия: модель вольна её не выполнить и записать в `data/output.md`
 * черновик первого раунда. Инструмент, которого нет в наборе, вызвать нельзя — поэтому
 * право на запись выдаёт harness, и только после `approve` (см. `saveApprovedPlan`).
 *
 * `stop_on_first_tool` завершает шаг сразу после записи: пересказывать сохранённый план
 * второй раз незачем, а каждый лишний круг — платный вызов.
 *
 * `toolChoice: 'required'` здесь напрашивается, но не ставится: DeepSeek в thinking-режиме
 * отвечает на него `400 Thinking mode does not support this tool_choice`. Гарантию вызова
 * даёт набор из одного инструмента плюс прямая инструкция; если агент всё-таки не вызовет
 * `savePlan`, harness это заметит и скажет в логе (см. `saveApprovedPlan`).
 */
export function createPlanSaver(instructions: string) {
  return new Agent({
    name: 'Health Coach',
    model: MODEL,
    instructions,
    tools: [savePlan],
    toolUseBehavior: 'stop_on_first_tool',
  });
}

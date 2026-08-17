import { Agent, type Tool } from '@openai/agents';
import { createKnowledgeSearch, type OnRetrieval } from '../skills/knowledge';
import { generateShoppingList } from '../skills/shopping';
import { suggestWorkoutTemplate } from '../skills/workouts';

const MODEL = process.env.DEEPSEEK_MODEL ?? 'deepseek-v4-pro';

/**
 * Локальные инструменты черновых кругов: обычные `tool()` из `src/skills/`.
 *
 * Данные о пользователе коуч берёт с MCP-сервера, а эти три работают без него — считают
 * производное от уже полученного (шаблон тренировки, список покупок по тексту плана) или
 * ходят в базу знаний (`searchKnowledge`). Они остались локальными намеренно: в одном
 * наборе с MCP видно, что для агента разницы нет — одно имя, одна схема параметров, один
 * след в `toolCalls`.
 *
 * `searchKnowledge` собирается на прогон, а не лежит готовым: ему нужен приёмник записей
 * о retrieval, и владеет им harness (см. `createCoach`).
 */
function localDraftTools(onRetrieval: OnRetrieval): Tool[] {
  return [suggestWorkoutTemplate, generateShoppingList, createKnowledgeSearch(onRetrieval)];
}

/**
 * Health Coach: пишет wellness-план под задачу.
 *
 * Системный промпт живёт в `prompts/healthCoach.<версия>.md` — сюда он приходит готовым
 * текстом, версию выбирает harness (`promptVersions.ts`). Инструменты чтения данных
 * приходят оттуда же: это MCP-инструменты со всех поднятых серверов одним списком,
 * а какие именно и с каких серверов — решает `src/mcp/servers.config.ts`, не агент.
 *
 * `onRetrieval` — колбэк для записей о поиске по базе знаний (`docs/spec8.md`). Куда они
 * лягут, агент не знает: он только прокидывает его в инструмент.
 */
export function createCoach(instructions: string, mcpTools: Tool[], onRetrieval: OnRetrieval) {
  return new Agent({
    name: 'Health Coach',
    model: MODEL,
    instructions,
    tools: [...mcpTools, ...localDraftTools(onRetrieval)],
  });
}

/**
 * Тот же коуч на шаге фиксации итога: доступны только необратимые инструменты —
 * `save_health_plan`, запись файла в `plans/`, создание страницы в Notion. Локальных
 * инструментов здесь нет вовсе, читающих тоже.
 *
 * Отдельная сборка агента, а не флаг в промпте, потому что «сохраняй только после одобрения» —
 * просьба, а не гарантия: модель вольна её не выполнить и записать в `data/output.md`
 * черновик первого раунда. Инструмента, которого нет в наборе, вызвать нельзя — поэтому
 * право на запись выдаёт harness, и только после `approve` (см. `saveApprovedPlan`).
 * Чужие серверы этого не изменили, а усилили: `filesystem` и `notion` пишут наружу проекта
 * и потому лежат в том же наборе, что и `save_health_plan`.
 *
 * `stop_on_first_tool` здесь стоял, пока инструмент был один, и снят по `docs/spec7.md`:
 * сохранений теперь может быть несколько подряд (файл в `data/`, файл в `plans/`, страница),
 * и остановка на первом обрубала бы шаг на полпути. Цена — один текстовый вызов сверху.
 *
 * `toolChoice: 'required'` здесь напрашивается, но не ставится: DeepSeek в thinking-режиме
 * отвечает на него `400 Thinking mode does not support this tool_choice`. Гарантию вызова
 * даёт короткий набор плюс прямая инструкция; если агент всё-таки не вызовет
 * `save_health_plan`, harness это заметит и скажет в логе (см. `saveApprovedPlan`).
 */
export function createPlanSaver(instructions: string, mcpTools: Tool[]) {
  return new Agent({ name: 'Health Coach', model: MODEL, instructions, tools: mcpTools });
}

import { Agent, type Tool } from '@openai/agents';
import { AGENT_MODEL, providerSettings } from '../harness/provider';
import { createKnowledgeSearch, type OnRetrieval } from '../skills/knowledge';
import { generateShoppingList } from '../skills/shopping';
import { suggestWorkoutTemplate } from '../skills/workouts';

/**
 * Модель и настройки шлюза приходят из `src/harness/provider.ts` — раньше имя модели
 * читалось здесь из env напрямую, и таких мест было три (`docs/specB.md`).
 *
 * Коуч — единственный, кому положена запасная модель: план пишет он, и обрыв на нём стоит
 * всего прогона, тогда как повторить дешёвый вызов роутера или ревьюера почти ничего не стоит.
 */
const COACH_SETTINGS = providerSettings({}, true);

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
 * Оставляет из набора только названные инструменты, в порядке белого списка.
 *
 * Имя, которого в наборе нет, — это опечатка в модуле OS или инструмент с выключенного
 * сервера. Молча отдать набор короче запрошенного нельзя: модуль объявил, что инструмент
 * ему нужен, а коуч пойдёт сочинять данные вместо вызова. Падаем сразу — агент собирается
 * до первого платного вызова.
 */
function pickTools(available: Tool[], names: readonly string[]): Tool[] {
  return names.map((name) => {
    const found = available.find((tool) => tool.name === name);
    if (!found) {
      throw new Error(`Инструмент ${name} недоступен. Есть: ${available.map((tool) => tool.name).join(', ')}`);
    }
    return found;
  });
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
 *
 * `allowedTools` — белый список имён от модуля OS (`docs/specA.md`): специализация модуля
 * это промпт плюс сокращённый набор. `undefined` — набор целиком, то есть поведение до
 * появления OS. Решение по-прежнему принимает не агент: сюда список приходит готовым.
 */
export function createCoach(
  instructions: string,
  mcpTools: Tool[],
  onRetrieval: OnRetrieval,
  allowedTools?: readonly string[],
) {
  const all = [...mcpTools, ...localDraftTools(onRetrieval)];
  return new Agent({
    name: 'Health Coach',
    model: AGENT_MODEL,
    modelSettings: COACH_SETTINGS,
    instructions,
    tools: allowedTools ? pickTools(all, allowedTools) : all,
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
  return new Agent({ name: 'Health Coach', model: AGENT_MODEL, modelSettings: COACH_SETTINGS, instructions, tools: mcpTools });
}

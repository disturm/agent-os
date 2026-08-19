/**
 * Роутер OS: по тексту задачи выбрать модуль (`docs/specA.md`).
 *
 * Один вызов дешёвой модели со списком модулей и их описаний — и всё. Никаких эмбеддингов
 * задачи, ключевых слов поверх LLM, дерева правил и второго прохода: спека прямо запрещает
 * усложнять роутер, и это правильно — ошибка классификации стоит неоптимального набора
 * инструментов, а не неверного плана. План всё равно проверит Safety Reviewer.
 *
 * Роутер — оптимизация, а не предохранитель. Поэтому он не бросает: не разобрали ответ,
 * не хватило уверенности, модель придумала своё имя — прогон идёт модулем `general`,
 * то есть ровно так, как шёл до появления OS. Единственное, что может уронить классификацию
 * до прогона, — недоступный провайдер, и это та же ошибка, что уронила бы и сам прогон.
 */

import { Agent, run } from '@openai/agents';
import { z } from 'zod';
// Импорт ради побочного эффекта: провайдер настраивается на загрузке этого модуля.
// Без него SDK уходит в OpenAI с пустым ключом — см. `src/harness/provider.ts`.
import '../harness/provider';
import { GENERAL, MODULES, findModule, type OsModule } from './modules';

/**
 * Модель классификации. Отдельная от `DEEPSEEK_MODEL` и по умолчанию дешёвая: задача —
 * выбрать одно слово из девяти, рассуждать здесь не над чем.
 */
const ROUTER_MODEL = process.env.DEEPSEEK_ROUTER_MODEL ?? 'deepseek-v4-flash';

/**
 * Порог уверенности. Ниже — `general`: специализация сужает набор инструментов, и делать
 * это на догадке дороже, чем не делать. Подбирался по факту, а не из теории: если роутер
 * начнёт часто сваливаться в `general` на понятных задачах, опускайте порог, а не
 * переписывайте описания модулей под него.
 */
export const CONFIDENCE_THRESHOLD = 0.6;

export type Intent = {
  module: OsModule;
  /** Уверенность роутера, 0…1. У `general` по недостатку уверенности — та, что вернула модель. */
  confidence: number;
};

const IntentSchema = z.object({
  module: z.string().min(1),
  confidence: z.number().min(0).max(1),
});

/** Список модулей для промпта: имя и описание, по строке на модуль. */
function moduleLines(): string {
  return MODULES.map((module) => `- ${module.name}: ${module.description}`).join('\n');
}

const INSTRUCTIONS = [
  'Ты — маршрутизатор запросов wellness-агента. Твоя работа — отнести задачу пользователя',
  'к одному из модулей и оценить, насколько ты в этом уверен.',
  '',
  'Модули:',
  moduleLines(),
  '',
  'Правила:',
  '- Выбирай ровно один модуль — тот, к которому задача относится в первую очередь.',
  '- Задача про целый день сразу (еда и тренировка и режим вместе) — это dailyPlan,',
  '  а не питание с тренировками по отдельности.',
  '- Не подходит ни один модуль или задача слишком общая — верни "general".',
  '- confidence — число от 0 до 1: 0.9 и выше, когда задача явно про этот модуль;',
  '  0.5 и ниже, когда сомневаешься. Не завышай.',
  '- Плана не пиши, вопросов не задавай, задачу не выполняй.',
  '',
  'Отвечай ТОЛЬКО одним JSON-объектом, без markdown-обёрток и текста вокруг:',
  '{"module":"<имя модуля>","confidence":0.0-1.0}',
].join('\n');

/**
 * Достаём вердикт роутера из ответа модели — тем же приёмом, что и у ревьюера
 * (`validateReview`): содержимое между первой `{` и последней `}`, потом Zod.
 *
 * Плюс запасной разбор по полям. Ретрая у роутера нет намеренно, поэтому единственная
 * попытка должна переживать мелкий мусор: в живых прогонах модель выдавала
 * `{"module":"recipes","confidence":0.95"}` — лишняя кавычка после числа, и строгий
 * `JSON.parse` на этом падает. Ронять из-за неё выбор модуля в `general` было бы обидно:
 * оба поля в строке есть и читаются однозначно. Это разбор, а не логика маршрутизации —
 * запрет specA «не усложнять роутер» он не нарушает.
 */
function parseIntent(text: string): z.infer<typeof IntentSchema> | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  const body = text.slice(start, end + 1);

  try {
    const parsed = IntentSchema.safeParse(JSON.parse(body));
    if (parsed.success) return parsed.data;
  } catch {
    // строгий разбор не удался — пробуем по полям
  }

  const module = body.match(/"module"\s*:\s*"([^"]+)"/)?.[1];
  const confidence = body.match(/"confidence"\s*:\s*([0-9]*\.?[0-9]+)/)?.[1];
  const salvaged = IntentSchema.safeParse({ module, confidence: Number(confidence) });
  return salvaged.success ? salvaged.data : null;
}

/**
 * Классифицирует задачу. Один вызов модели, ретраев нет: невалидный ответ — это `general`,
 * а не повод платить второй раз за выбор, который и так есть чем заменить.
 */
export async function classifyIntent(task: string): Promise<Intent> {
  const router = new Agent({ name: 'Intent Router', model: ROUTER_MODEL, instructions: INSTRUCTIONS, tools: [] });
  const result = await run(router, `=== ЗАДАЧА ===\n${task}`);
  const parsed = parseIntent(result.finalOutput ?? '');

  if (!parsed) {
    // Текст ответа в предупреждение: «невалидный JSON» без него ничего не объясняет,
    // а починить промпт классификации можно только увидев, что модель написала вместо него.
    const shown = (result.finalOutput ?? '').replace(/\s+/g, ' ').slice(0, 200);
    console.warn(`  ! роутер вернул невалидный ответ — модуль general. Ответ: «${shown}»`);
    return { module: GENERAL, confidence: 0 };
  }

  // Имя, которого нет в каталоге, findModule сводит к general: придуманный роутером модуль
  // и модуль, в котором он не уверен, — для прогона одно и то же.
  const module = parsed.confidence < CONFIDENCE_THRESHOLD ? GENERAL : findModule(parsed.module);
  return { module, confidence: parsed.confidence };
}

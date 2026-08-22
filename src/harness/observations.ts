/**
 * Что происходило за прогон и когда: накопитель наблюдений (`docs/specB.md`).
 *
 * До specB harness помнил о прогоне три вещи: список вызванных инструментов, записи
 * о retrieval и общую длительность. Для файла в `runs/` этого хватало, а для дерева спанов
 * в Langfuse — нет: там у каждого шага свои границы, свой вход-выход и своя стоимость.
 *
 * Модуль собран тем же приёмом, что `rounds.ts` и `toolCalls.ts`: он только накапливает.
 * Решений не принимает, наружу ничего не отправляет и — главное — **про Langfuse не знает**.
 * Симметрия с `runEvents.ts`: там формат наблюдения за ходом прогона, здесь формат его следа,
 * и ни тот, ни другой не в курсе, кто это будет читать. Поэтому прогон без Langfuse
 * отличается от прежнего ровно на несколько `push` в массив, и UI, evals и replay
 * продолжают работать без правок — как того требует спека.
 */

/** Что за шаг. Ложится в тип наблюдения на стороне платформы: вызов модели, инструмент, поиск. */
export type ObservationKind = 'generation' | 'tool' | 'retrieval' | 'step';

/**
 * Расход на вызов модели.
 *
 * `cost` приходит от шлюза как факт, а не считается нами по прайсу: у OpenRouter он есть
 * в ответе, если попросить (см. `providerSettings`). Нет его — поле пустое, и стоимость
 * досчитает платформа по модели и токенам.
 */
export type ObservationUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cost?: number;
};

export type Observation = {
  name: string;
  kind: ObservationKind;
  /** Раунд ревью, к которому относится шаг. `undefined` — шаг вне круга (фиксация плана). */
  round?: number;
  /** Границы шага, ISO. По ним платформа рисует длительность, поэтому они настоящие, а не расчётные. */
  startedAt: string;
  endedAt: string;
  input?: unknown;
  output?: unknown;
  model?: string;
  usage?: ObservationUsage;
  metadata?: Record<string, unknown>;
};

/** Чем наблюдение дополняется в момент закрытия: до вызова эти поля ещё неизвестны. */
export type ObservationEnd = Partial<Pick<Observation, 'input' | 'output' | 'model' | 'usage' | 'metadata'>>;

export type ObservationLog = {
  /**
   * Открывает наблюдение и возвращает функцию закрытия.
   *
   * Пара «открыть → закрыть» вместо «записать факт» потому, что засечь конец шага можно
   * только там, где шаг заканчивается, а закрытие обязано случиться и на исключении.
   */
  open(name: string, kind: ObservationKind, round?: number): (end?: ObservationEnd) => void;
  /** Копия накопленного, по порядку открытия. */
  all(): Observation[];
};

/**
 * Форма результата прогона в части расхода. Структурная намеренно: модуль не тянет типы SDK
 * и остаётся тем же простым накопителем, что и был.
 */
export type UsageSource = {
  rawResponses?: readonly {
    usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
    providerData?: unknown;
  }[];
};

/**
 * Расход по одному обращению к агенту: токены и, если шлюз её вернул, фактическая стоимость.
 *
 * Один вызов агента — это несколько запросов к модели (круг с инструментами плюс финальный
 * текст), поэтому суммируем `rawResponses`. Стоимость лежит не в нормализованном `usage`
 * SDK, а в сыром ответе провайдера: OpenRouter кладёт её в `usage.cost`, когда его об этом
 * попросили (см. `providerSettings`). Не нашли — поля просто нет, и цену досчитает Langfuse
 * по модели и токенам. Нулём её подменять нельзя: получилось бы «вызов бесплатный».
 *
 * Живёт здесь, а не у оркестратора, потому что отдаёт `ObservationUsage` — тип этого модуля,
 * и нужен всем, кто зовёт модель: и harness, и роутеру OS.
 */
export function usageOf(...results: UsageSource[]): ObservationUsage {
  const totals = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  let cost: number | undefined;

  for (const result of results) {
    for (const response of result.rawResponses ?? []) {
      totals.inputTokens += response.usage?.inputTokens ?? 0;
      totals.outputTokens += response.usage?.outputTokens ?? 0;
      totals.totalTokens += response.usage?.totalTokens ?? 0;
      const reported = (response.providerData as { usage?: { cost?: number } } | undefined)?.usage?.cost;
      if (typeof reported === 'number') cost = (cost ?? 0) + reported;
    }
  }

  return { ...totals, ...(cost === undefined ? {} : { cost }) };
}

export function createObservationLog(): ObservationLog {
  const items: Observation[] = [];

  return {
    open(name, kind, round) {
      // Место в списке занимается сразу: порядок наблюдений — это порядок начала шагов,
      // а не их завершения. Иначе параллельные вызовы searchKnowledge перемешались бы.
      const index = items.push({ name, kind, round, startedAt: new Date().toISOString(), endedAt: '' }) - 1;
      return (end = {}) => {
        items[index] = { ...items[index], ...end, endedAt: new Date().toISOString() };
      };
    },
    all: () => [...items],
  };
}

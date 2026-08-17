/**
 * Векторизация текста: один POST на OpenAI-совместимый `/embeddings`.
 *
 * Модуль знает только про эмбеддинги. Ни про Supabase, ни про базу знаний, ни про агента
 * здесь ничего нет: на входе строки, на выходе числа. Тем же вызовом пользуются обе стороны
 * RAG — `scripts/ingest.ts` векторизует секции файлов, `retriever.ts` векторизует запрос.
 * Это не совпадение, а условие работы поиска: чанки и запрос обязаны попасть в одно
 * пространство, то есть пройти через одну и ту же модель.
 *
 * Провайдер отдельный от DeepSeek намеренно: у DeepSeek нет эндпоинта эмбеддингов, поэтому
 * `EMBEDDING_*` — самостоятельная тройка переменных, а не производная от `DEEPSEEK_*`.
 * Клиентских библиотек нет: обычный `fetch`, как и во всём RAG-слое (`docs/spec8.md`).
 */

/** По умолчанию — OpenAI. Любой другой OpenAI-совместимый провайдер задаётся через `.env`. */
const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'text-embedding-3-small';

/**
 * Размерность вектора модели по умолчанию. Она же зашита в `vector(1536)` миграции
 * `docs/001_create_knowledge_chunks_table.sql` — сменили модель, меняйте оба места разом,
 * иначе вставка упадёт на несовпадении длины.
 */
export const EMBEDDING_DIMENSIONS = 1536;

/**
 * Сколько текстов уходит одним запросом. Ингест зовёт эмбеддинги десятками, и по чанку на
 * запрос — это десятки round-trip'ов на ровном месте; батч целиком упирается в лимит тела
 * запроса. 32 — компромисс, который держится на секциях любого разумного размера.
 */
const BATCH_SIZE = 32;

type EmbeddingConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
};

/**
 * Настройки читаются на каждый вызов, а не на загрузке модуля: в Next переменные окружения
 * доступны не всегда в тот момент, когда модуль импортируется, и падать на импорте
 * (роняя весь роут) хуже, чем падать в месте использования.
 */
function readConfig(): EmbeddingConfig {
  const apiKey = process.env.EMBEDDING_API_KEY?.trim();
  if (!apiKey) throw new Error('Нет EMBEDDING_API_KEY в .env (см. .env.example) — без него RAG не работает');
  return {
    baseUrl: (process.env.EMBEDDING_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, ''),
    apiKey,
    model: process.env.EMBEDDING_MODEL?.trim() || DEFAULT_MODEL,
  };
}

/**
 * Проверка настроек без обращения к провайдеру. Зовётся до первого платного вызова модели:
 * прогон, который упадёт на отсутствующем ключе через минуту работы, дороже прогона,
 * который не начался.
 */
export function assertEmbeddingConfigured(): void {
  readConfig();
}

/** Имя модели эмбеддингов — для логов ингеста, чтобы было видно, чем залита база. */
export function embeddingModel(): string {
  return readConfig().model;
}

type EmbeddingResponse = {
  data?: { index?: number; embedding?: number[] }[];
};

/** Один запрос к провайдеру. Порядок ответов не гарантирован спекой — раскладываем по `index`. */
async function embedBatch({ baseUrl, apiKey, model }: EmbeddingConfig, texts: string[]): Promise<number[][]> {
  const response = await fetch(`${baseUrl}/embeddings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, input: texts }),
  });

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new Error(`Эмбеддинги (${model}): ${response.status} ${response.statusText}. ${detail}`);
  }

  const payload = (await response.json()) as EmbeddingResponse;
  const vectors: number[][] = [];
  for (const [position, item] of (payload.data ?? []).entries()) {
    const vector = item?.embedding;
    if (!Array.isArray(vector)) throw new Error(`Эмбеддинги (${model}): в ответе нет вектора для элемента ${position}`);
    vectors[item.index ?? position] = vector;
  }

  if (vectors.length !== texts.length || vectors.some((vector) => !vector)) {
    throw new Error(`Эмбеддинги (${model}): просили ${texts.length} векторов, получили ${vectors.filter(Boolean).length}`);
  }
  return vectors;
}

/**
 * Векторы для списка текстов, в том же порядке. Батчи идут последовательно: параллелить их
 * незачем — ингест не в горячем пути, а провайдеры считают rate limit по минутам.
 */
export async function embedAll(texts: string[]): Promise<number[][]> {
  if (!texts.length) return [];
  const config = readConfig();

  const vectors: number[][] = [];
  for (let start = 0; start < texts.length; start += BATCH_SIZE) {
    vectors.push(...(await embedBatch(config, texts.slice(start, start + BATCH_SIZE))));
  }
  return vectors;
}

/** Вектор одного текста — то, что нужно ретриверу на каждый запрос агента. */
export async function embed(text: string): Promise<number[]> {
  const [vector] = await embedAll([text]);
  return vector;
}

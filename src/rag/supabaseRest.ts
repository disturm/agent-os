/**
 * Доступ к Supabase через PostgREST: единственное место в проекте, где написано,
 * как складывается URL и какие заголовки нужны.
 *
 * Клиентских библиотек нет намеренно (`docs/spec8.md`): вся работа с базой — это три
 * операции обычным `fetch`. Вставка и удаление идут по таблице напрямую, а поиск по
 * вектору — вызовом SQL-функции (`rpc`), потому что PostgREST не умеет сортировать по
 * оператору `<=>`; сам запрос лежит в `docs/002_create_match_knowledge_chunks_function.sql`.
 *
 * Про базу знаний модуль ничего не знает: имя таблицы и имя функции приходят параметром.
 *
 * Ключ здесь — service role: он обходит RLS, поэтому попасть в браузер не должен никогда.
 * И ингест, и retrieval работают на сервере (скрипт, route handler, CLI), клиентского кода
 * поверх этого модуля нет.
 */

type SupabaseConfig = {
  restUrl: string;
  key: string;
};

/**
 * Настройки читаются на каждый вызов по той же причине, что и в `embedding.ts`:
 * падать на импорте модуля хуже, чем в месте использования.
 */
function readConfig(): SupabaseConfig {
  const url = process.env.SUPABASE_URL?.trim();
  if (!url) throw new Error('Нет SUPABASE_URL в .env (см. .env.example) — без него RAG не работает');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!key) throw new Error('Нет SUPABASE_SERVICE_ROLE_KEY в .env (см. .env.example) — без него RAG не работает');
  return { restUrl: `${url.replace(/\/+$/, '')}/rest/v1`, key };
}

/** Проверка настроек без обращения к сети. Зовётся до первого платного вызова модели. */
export function assertSupabaseConfigured(): void {
  readConfig();
}

function headers({ key }: SupabaseConfig, extra: Record<string, string> = {}): Record<string, string> {
  return {
    apikey: key,
    authorization: `Bearer ${key}`,
    'content-type': 'application/json',
    ...extra,
  };
}

/** Ошибку PostgREST показываем телом ответа: там лежит причина (нет таблицы, не та размерность вектора). */
async function ensureOk(response: Response, what: string): Promise<void> {
  if (response.ok) return;
  const detail = (await response.text()).slice(0, 300);
  throw new Error(`Supabase (${what}): ${response.status} ${response.statusText}. ${detail}`);
}

/**
 * Вызов SQL-функции. Тело запроса — её именованные аргументы как есть.
 *
 * Вектор уезжает обычным массивом чисел: PostgREST сериализует его в `[0.1,0.2,…]`,
 * а это ровно тот текстовый формат, который pgvector принимает на вход.
 */
export async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const config = readConfig();
  const response = await fetch(`${config.restUrl}/rpc/${fn}`, {
    method: 'POST',
    headers: headers(config),
    body: JSON.stringify(args),
  });
  await ensureOk(response, `rpc ${fn}`);
  return (await response.json()) as T;
}

/** Вставка строк пачкой. `return=minimal` — ответ нам не нужен, а с ним ответ распухает на все векторы. */
export async function insertRows(table: string, rows: Record<string, unknown>[]): Promise<void> {
  if (!rows.length) return;
  const config = readConfig();
  const response = await fetch(`${config.restUrl}/${table}`, {
    method: 'POST',
    headers: headers(config, { prefer: 'return=minimal' }),
    body: JSON.stringify(rows),
  });
  await ensureOk(response, `insert ${table}`);
}

/**
 * Очистка таблицы целиком. Фильтр `id=gte.0` стоит не для красоты: PostgREST отвергает
 * DELETE без условия, чтобы случайное удаление всей таблицы нельзя было отправить опечаткой.
 * Здесь оно как раз намеренное — на этом держится идемпотентность ингеста.
 */
export async function deleteAllRows(table: string): Promise<void> {
  const config = readConfig();
  const response = await fetch(`${config.restUrl}/${table}?id=gte.0`, {
    method: 'DELETE',
    headers: headers(config, { prefer: 'return=minimal' }),
  });
  await ensureOk(response, `delete ${table}`);
}

/** Сколько строк в таблице: HEAD-запрос с `count=exact`, ответ приходит заголовком `content-range`. */
export async function countRows(table: string): Promise<number> {
  const config = readConfig();
  const response = await fetch(`${config.restUrl}/${table}?select=id`, {
    method: 'HEAD',
    headers: headers(config, { prefer: 'count=exact' }),
  });
  await ensureOk(response, `count ${table}`);
  const total = response.headers.get('content-range')?.split('/')[1];
  return Number(total ?? 0);
}

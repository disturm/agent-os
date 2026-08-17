/**
 * Ингест базы знаний: `knowledge/*.md` → чанки → эмбеддинги → таблица `knowledge_chunks`.
 *
 *   npm run ingest
 *   npm run ingest -- --dry    # только разбор на чанки, без сети и без затрат
 *
 * Это инструмент подготовки данных, а не часть продукта: агента он не вызывает и на его
 * поведение не влияет — так же, как `replay` и `eval` (`docs/spec5.md`). Чанкинг живёт
 * здесь, потому что он и есть решение об устройстве базы: одна секция `##` — один чанк.
 *
 * Идемпотентность — через полную перезаливку: таблица очищается и наполняется заново.
 * Это грубо, но честно и не оставляет висеть чанки от секций, которые переименовали или
 * удалили. База знаний маленькая и правится руками, инкрементальный ингест ей не нужен.
 *
 * Перед первым запуском выполните миграции из `docs/`: 001 создаёт таблицу и индекс,
 * 002 — функцию поиска.
 */

import 'dotenv/config'; // первым: и Supabase, и провайдер эмбеддингов читают env
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { embedAll, embeddingModel } from '../src/rag/embedding';
import { KNOWLEDGE_TABLE } from '../src/rag/retriever';
import { countRows, deleteAllRows, insertRows } from '../src/rag/supabaseRest';

/** Каталог базы знаний, от корня проекта. Запускать команды из корня. */
const KNOWLEDGE_DIR = join(process.cwd(), 'knowledge');

/** Граница чанка: строка вида `## Заголовок`. `###` внутри секции её не режет — это часть текста. */
const SECTION = /^##\s+(.+?)\s*$/;

/** Сколько строк уходит одним POST. Векторы тяжёлые, класть всю базу одним телом запроса незачем. */
const INSERT_BATCH = 20;

type Chunk = {
  /** Имя файла-источника: `recipes.md`. Путь не храним — каталог один. */
  file: string;
  heading: string;
  content: string;
};

/**
 * Разбор одного файла на секции.
 *
 * Всё, что стоит до первого `##` (заголовок файла и вводный абзац), в чанки не попадает:
 * это пояснение для человека, а не знание. Пустые секции отбрасываются — искать по одному
 * заголовку нечего.
 */
function chunkFile(file: string, markdown: string): Chunk[] {
  const chunks: Chunk[] = [];
  let heading: string | undefined;
  let body: string[] = [];

  const flush = () => {
    const content = body.join('\n').trim();
    if (heading && content) chunks.push({ file, heading, content });
    body = [];
  };

  for (const line of markdown.split(/\r?\n/)) {
    const match = SECTION.exec(line);
    if (match) {
      flush();
      heading = match[1];
    } else if (heading) {
      body.push(line);
    }
  }
  flush();

  return chunks;
}

function readKnowledge(): Chunk[] {
  let files: string[];
  try {
    files = readdirSync(KNOWLEDGE_DIR).filter((name) => name.endsWith('.md')).sort();
  } catch {
    throw new Error(`Нет каталога ${KNOWLEDGE_DIR} — база знаний лежит в knowledge/*.md`);
  }
  if (!files.length) throw new Error(`В ${KNOWLEDGE_DIR} нет ни одного .md — заливать нечего`);

  const chunks = files.flatMap((file) => chunkFile(file, readFileSync(join(KNOWLEDGE_DIR, file), 'utf8')));
  if (!chunks.length) throw new Error('Ни одной секции `## ` в knowledge/*.md — чанкинг режет именно по ним');
  return chunks;
}

/**
 * Текст, который уходит в эмбеддинг. Заголовок и имя файла добавляются к телу секции
 * намеренно: в теле рецепта не написано, что это рецепт, а запрос «ужин с высоким белком»
 * попадает как раз в заголовок. Без этой строки поиск заметно тупеет.
 */
function embeddingText({ file, heading, content }: Chunk): string {
  return `${file.replace(/\.md$/, '')} / ${heading}\n\n${content}`;
}

function printChunks(chunks: Chunk[]): void {
  const byFile = new Map<string, Chunk[]>();
  for (const chunk of chunks) byFile.set(chunk.file, [...(byFile.get(chunk.file) ?? []), chunk]);

  for (const [file, group] of byFile) {
    console.log(`\n=== ${file} === (${group.length} секц.)`);
    for (const chunk of group) console.log(`  ${chunk.heading.padEnd(46)} ${chunk.content.length} симв.`);
  }
}

async function main(): Promise<number> {
  const dryRun = process.argv.slice(2).includes('--dry');

  const chunks = readKnowledge();
  const files = new Set(chunks.map((chunk) => chunk.file)).size;
  console.log(`База знаний: ${files} файл(ов), ${chunks.length} секц. → столько же чанков.`);
  printChunks(chunks);

  if (dryRun) {
    console.log('\n--dry: сеть не трогали, эмбеддинги не считали, таблица не изменилась.');
    return 0;
  }

  console.log(`\nСчитаю эмбеддинги (${embeddingModel()})…`);
  const vectors = await embedAll(chunks.map(embeddingText));

  // Очистка и заливка идут подряд: между ними база пустая, и параллельный прогон агента
  // в этот момент ничего не найдёт. Ингест — ручная операция, конкурировать с ним некому.
  console.log(`Очищаю ${KNOWLEDGE_TABLE} и заливаю заново…`);
  await deleteAllRows(KNOWLEDGE_TABLE);

  for (let start = 0; start < chunks.length; start += INSERT_BATCH) {
    const rows = chunks.slice(start, start + INSERT_BATCH).map((chunk, offset) => ({
      file: chunk.file,
      heading: chunk.heading,
      content: chunk.content,
      embedding: vectors[start + offset],
    }));
    await insertRows(KNOWLEDGE_TABLE, rows);
    console.log(`  залито ${Math.min(start + INSERT_BATCH, chunks.length)}/${chunks.length}`);
  }

  const total = await countRows(KNOWLEDGE_TABLE);
  console.log(`\nГотово: в ${KNOWLEDGE_TABLE} ${total} строк(и).`);
  if (total !== chunks.length) {
    console.warn(`! ожидалось ${chunks.length} — в таблице лежит что-то ещё или залилось не всё`);
    return 1;
  }
  return 0;
}

process.exitCode = await main().catch((err: unknown) => {
  console.error(`Ошибка: ${err instanceof Error ? err.message : String(err)}`);
  return 1;
});

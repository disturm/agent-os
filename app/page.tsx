'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { useEffect, useRef, useState } from 'react';

import { BlockedCard } from '@/components/BlockedCard';
import { PlanView } from '@/components/PlanView';
import { RunSummary } from '@/components/RunSummary';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Timeline } from '@/components/Timeline';
import type { ChatMessage } from '@/lib/chat-stream';

/**
 * Чат с агентом (`docs/spec9.md`). Всё состояние — здесь и в `useChat`; истории между
 * перезагрузками нет и не задумано: ни localStorage, ни базы, ни второго диалога.
 *
 * Каждое сообщение — отдельный прогон harness со своей задачей. Предыдущие сообщения
 * в промпт не уходят: состояния между запросами в проекте нет (`docs/spec2.md`), и чат
 * здесь — способ показать ход работы, а не переписка с памятью.
 */
export default function Page() {
  const { messages, sendMessage, status, error } = useChat<ChatMessage>({
    transport: new DefaultChatTransport({ api: '/api/chat' }),
  });
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  const busy = status === 'submitted' || status === 'streaming';

  // Автоскролл: сообщения растут по мере стрима, поэтому следим за ними, а не за их числом.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, status]);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!input.trim() || busy) return;
    sendMessage({ text: input.trim() });
    setInput('');
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-3xl flex-col px-6">
      <header className="flex items-start justify-between gap-6 border-b border-border py-8">
        <div>
          <h1 className="font-serif text-3xl tracking-[-0.03em] text-primary">
            Wellness-агент
            <span aria-hidden className="ml-2 inline-block size-2 -translate-y-[0.15em] rounded-[2px] bg-brand" />
          </h1>
          <p className="mt-2 max-w-xl text-sm text-muted-foreground">
            Коуч пишет план, Safety Reviewer его проверяет. Это не медицинский продукт: диагнозы, лекарства и
            дозировки вне его компетенции.
          </p>
        </div>
        <ThemeToggle />
      </header>

      <main className="flex-1 space-y-8 py-8" aria-live="polite" aria-busy={busy}>
        {messages.length === 0 && <EmptyState />}

        {messages.map((message) =>
          message.role === 'user' ? (
            <UserMessage key={message.id} message={message} />
          ) : (
            <AgentMessage key={message.id} message={message} />
          ),
        )}

        {/* До первой части стрима показывать нечего: серверы MCP ещё поднимаются. */}
        {status === 'submitted' && <p className="text-sm text-muted-foreground">Поднимаю MCP-серверы…</p>}

        {error && (
          <p className="rounded-lg bg-stop p-4 font-mono text-xs break-all text-stop-foreground">{error.message}</p>
        )}

        <div ref={bottomRef} />
      </main>

      <form onSubmit={submit} className="sticky bottom-0 flex gap-3 border-t border-border bg-background py-4">
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) submit(event);
          }}
          disabled={busy}
          rows={2}
          placeholder="Составь план питания на завтра"
          className="flex-1 resize-none rounded-lg border border-input bg-card px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="h-fit self-end rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-brand-foreground transition-colors hover:bg-brand-hover disabled:opacity-40"
        >
          {busy ? 'Работаю…' : 'Отправить'}
        </button>
      </form>
    </div>
  );
}

function UserMessage({ message }: { message: ChatMessage }) {
  const text = message.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n');

  return (
    <p className="ml-auto max-w-[85%] rounded-lg bg-secondary px-4 py-2.5 text-sm whitespace-pre-wrap text-secondary-foreground">
      {text}
    </p>
  );
}

/**
 * Ответ агента: таймлайн этапов, затем план (или карточка предохранителя), затем итог.
 * Порядок задаёт сервер — части рисуются в том же порядке, в каком записаны в стрим.
 */
function AgentMessage({ message }: { message: ChatMessage }) {
  const plan = message.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('');
  const blocked = message.parts.find((part) => part.type === 'data-blocked');
  const summary = message.parts.find((part) => part.type === 'data-summary');

  return (
    <article className="space-y-6">
      <Timeline parts={message.parts} />
      {blocked && <BlockedCard issues={blocked.data.issues} />}
      {plan && <PlanView plan={plan} />}
      {summary && <RunSummary {...summary.data} />}
    </article>
  );
}

/** До первого запуска экран объясняет, как устроен прогон. */
function EmptyState() {
  const steps = [
    ['Health Coach', 'Сам берёт профиль, дневник и рецепты инструментами, ищет в базе знаний и пишет план.'],
    ['Safety Reviewer', 'Видит только план, проверяет границы wellness и ставит оценку до 10.'],
    ['Revision loop', 'До трёх раундов правок; одобренный план агент сохраняет сам.'],
  ];

  return (
    <ol className="divide-y divide-border border-y border-border">
      {steps.map(([title, description], index) => (
        <li key={title} className="flex gap-4 py-4">
          <span className="font-mono text-xs text-brand">{String(index + 1).padStart(2, '0')}</span>
          <div>
            <p className="text-sm font-medium">{title}</p>
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

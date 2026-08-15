'use client';

import { ArrowRightIcon } from '@radix-ui/react-icons';
import type { KeyboardEvent } from 'react';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

type AgentFormProps = {
  task: string;
  onTaskChange: (task: string) => void;
  onSubmit: () => void;
  running: boolean;
};

/** Левая колонка: ввод задачи и запуск. Своего состояния не держит. */
export function AgentForm({ task, onTaskChange, onSubmit, running }: AgentFormProps) {
  const canSubmit = !running && task.trim().length > 0;

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && canSubmit) {
      event.preventDefault();
      onSubmit();
    }
  }

  return (
    <div>
      <label
        htmlFor="task"
        className="mb-3 block text-xs font-medium tracking-[0.12em] text-muted-foreground uppercase"
      >
        Задача
      </label>

      <Textarea
        id="task"
        value={task}
        onChange={(event) => onTaskChange(event.target.value)}
        onKeyDown={handleKeyDown}
        disabled={running}
        rows={5}
        placeholder="Например: составь план питания на завтра"
        className="resize-none rounded-lg border-border bg-card text-base shadow-none md:text-sm"
      />

      <div className="mt-4 flex items-center justify-between gap-4">
        <p className="text-xs text-muted-foreground">
          <kbd className="rounded-sm border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px]">Ctrl</kbd>
          <span className="px-1">+</span>
          <kbd className="rounded-sm border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px]">Enter</kbd>
        </p>

        <Button
          onClick={onSubmit}
          disabled={!canSubmit}
          className="rounded-md bg-brand text-brand-foreground shadow-none transition-transform hover:bg-brand-hover active:scale-[0.98]"
        >
          {running ? 'Агент работает' : 'Запустить агента'}
          {!running && <ArrowRightIcon />}
        </Button>
      </div>
    </div>
  );
}

/**
 * Таймлайн прогона: этапы и вызовы инструментов под ними.
 *
 * Компонент презентационный — состояния не держит, порядок не решает. И то и другое приходит
 * готовым из стрима: этапы объявлены в порядке спеки (`app/api/chat/timeline.ts`), а каждая
 * строка инструмента знает, под каким этапом ей стоять.
 */

import { SEARCH_KNOWLEDGE_TOOL, TOOL_META } from '@/lib/agent-result';
import { LOCAL_SOURCE, type ChatMessagePart, type StepData, type StepStatus, type ToolData } from '@/lib/chat-stream';

/**
 * Три класса источника из `docs/spec9.md`. Наши источники подробнее (имя сервера из конфига),
 * поэтому имя показывается рядом с плашкой, а не вместо неё: «с какого именно сервера» —
 * ровно тот вопрос, ради которого источник в трейсе и появился.
 */
function toolKind(tool: ToolData): 'mcp' | 'rag' | 'local' {
  if (tool.source !== LOCAL_SOURCE) return 'mcp';
  return tool.name === SEARCH_KNOWLEDGE_TOOL ? 'rag' : 'local';
}

const KIND_BADGE: Record<'mcp' | 'rag' | 'local', string> = {
  mcp: 'bg-secondary text-secondary-foreground',
  rag: 'bg-approve text-approve-foreground',
  local: 'bg-muted text-muted-foreground',
};

/** Значок статуса. Крутящаяся точка — единственная анимация в таймлайне. */
function StepMark({ status }: { status: StepStatus }) {
  if (status === 'running') {
    return (
      <span
        aria-hidden
        className="mt-[7px] size-3 shrink-0 animate-spin rounded-full border-2 border-brand border-t-transparent"
      />
    );
  }
  const glyph = status === 'done' ? '✓' : status === 'skipped' ? '–' : '·';
  const tone = status === 'done' ? 'text-brand' : 'text-muted-foreground';
  return (
    <span aria-hidden className={`mt-0.5 w-3 shrink-0 text-center font-mono text-xs ${tone}`}>
      {glyph}
    </span>
  );
}

function ToolRow({ tool }: { tool: ToolData }) {
  const kind = toolKind(tool);
  return (
    <li className="text-sm">
      <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className={`rounded-sm px-1.5 py-0.5 font-mono text-[11px] ${KIND_BADGE[kind]}`}>[{kind}]</span>
        <span className="font-mono text-[13px]">{tool.name}</span>
        {/* Незнакомый инструмент показываем как есть: чужие серверы отдают их десятками. */}
        {TOOL_META[tool.name] && <span className="text-muted-foreground">— {TOOL_META[tool.name]}</span>}
        {kind === 'mcp' && <span className="text-xs text-muted-foreground">{tool.source}</span>}
      </span>
      {tool.query && (
        <span className="mt-1 block text-[13px] text-muted-foreground">
          🔍 «{tool.query}» → {tool.headings?.length ?? 0} chunks
          {tool.headings?.map((heading) => (
            <span key={heading} className="block pl-5">
              · {heading}
            </span>
          ))}
        </span>
      )}
    </li>
  );
}

function StepRow({ step, tools }: { step: StepData; tools: ToolData[] }) {
  return (
    <li className="flex gap-3 py-2">
      <StepMark status={step.status} />
      <div className="min-w-0 flex-1">
        <p className={step.status === 'pending' || step.status === 'skipped' ? 'text-muted-foreground' : ''}>
          <span className="text-sm font-medium">{step.label}</span>
          {step.detail && <span className="ml-2 font-mono text-xs text-muted-foreground">{step.detail}</span>}
          {step.status === 'skipped' && <span className="ml-2 text-xs text-muted-foreground">не понадобился</span>}
        </p>

        {step.issues && step.issues.length > 0 && (
          <ul className="mt-1.5 space-y-1 text-[13px] text-muted-foreground">
            {step.issues.map((issue) => (
              <li key={issue} className="before:mr-1.5 before:content-['—']">
                {issue}
              </li>
            ))}
          </ul>
        )}

        {tools.length > 0 && <ul className="mt-2 space-y-2 border-l border-border pl-3">{tools.map((tool, index) => <ToolRow key={index} tool={tool} />)}</ul>}
      </div>
    </li>
  );
}

export function Timeline({ parts }: { parts: ChatMessagePart[] }) {
  const steps: { id: string; data: StepData }[] = [];
  const toolsByStep = new Map<string, ToolData[]>();

  for (const part of parts) {
    if (part.type === 'data-step' && part.id) steps.push({ id: part.id, data: part.data });
    if (part.type === 'data-tool') {
      const list = toolsByStep.get(part.data.step) ?? [];
      list.push(part.data);
      toolsByStep.set(part.data.step, list);
    }
  }

  if (!steps.length) return null;

  return (
    <ol className="divide-y divide-border border-y border-border">
      {steps.map(({ id, data }) => (
        <StepRow key={id} step={data} tools={toolsByStep.get(id) ?? []} />
      ))}
    </ol>
  );
}

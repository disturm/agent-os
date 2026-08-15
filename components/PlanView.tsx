import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Правая колонка: план коуча. Модель отвечает markdown-ом, поэтому текст рендерится,
 * а не показывается как <pre> — заголовки и списки и есть структура плана.
 */
export function PlanView({ plan }: { plan: string }) {
  return (
    <div className="enter max-w-2xl text-[15px] leading-[1.7]">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h2 className="mt-10 mb-4 font-serif text-2xl tracking-[-0.02em] first:mt-0">{children}</h2>
          ),
          h2: ({ children }) => (
            <h3 className="mt-10 mb-3 border-t border-border pt-5 font-serif text-xl tracking-[-0.02em] first:mt-0 first:border-0 first:pt-0">
              {children}
            </h3>
          ),
          h3: ({ children }) => (
            <h4 className="mt-7 mb-2 text-xs font-medium tracking-[0.12em] text-muted-foreground uppercase">
              {children}
            </h4>
          ),
          p: ({ children }) => <p className="my-3">{children}</p>,
          ul: ({ children }) => <ul className="my-3 space-y-1.5 pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="my-3 list-decimal space-y-1.5 pl-5">{children}</ol>,
          li: ({ children }) => (
            <li className="relative marker:text-brand before:absolute before:-ml-4 before:text-brand before:content-['—'] [ol_&]:before:content-none">
              {children}
            </li>
          ),
          strong: ({ children }) => <strong className="font-medium text-foreground">{children}</strong>,
          hr: () => <hr className="my-8 border-border" />,
          code: ({ children }) => (
            <code className="rounded-sm bg-muted px-1.5 py-0.5 font-mono text-[13px]">{children}</code>
          ),
          blockquote: ({ children }) => (
            <blockquote className="my-4 border-l-2 border-border pl-4 text-muted-foreground">{children}</blockquote>
          ),
          table: ({ children }) => (
            <div className="my-5 overflow-x-auto">
              <table className="w-full border-collapse text-sm">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border-b border-border px-3 py-2 text-left text-xs font-medium tracking-[0.08em] text-muted-foreground uppercase">
              {children}
            </th>
          ),
          td: ({ children }) => <td className="border-b border-border px-3 py-2 align-top">{children}</td>,
        }}
      >
        {plan}
      </Markdown>
    </div>
  );
}

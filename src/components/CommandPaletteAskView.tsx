/**
 * Ask-mode body for Cmd+K. Replaces the registry-driven results scroll
 * area with a markdown viewer wired to the `useAsk` hook. The palette's
 * input row, chip strip, and Enter binding feed this — when the user is
 * mid-typing the view shows a hint; on submit it shows a spinner; on
 * resolve the markdown lands; on error a soft inline message.
 */
import { useMemo } from 'react';
import { Loader2, AlertCircle, Sparkles } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ScrollArea } from '@/components/ui/ScrollArea';
import type { AskState } from '@/hooks/useAsk';

interface AskViewProps {
  state: AskState;
  /** Text in the palette input — used to render an empty-state hint
   *  ("Press Enter to ask…") that disappears once a question has been
   *  submitted at least once. */
  pendingQueryDraft: string;
}

export function CommandPaletteAskView({ state, pendingQueryDraft }: AskViewProps) {
  // Render-time hint copy. We don't want to recompute the ReactMarkdown
  // tree just because the user kept typing — memoise on `markdown` only.
  const markdownNode = useMemo(() => {
    if (state.status !== 'ready') return null;
    return (
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        // The default react-markdown elements inherit color/spacing from
        // the surrounding palette. We override a few so the prose reads
        // like in-app copy, not a docs page.
        components={{
          h1: ({ children }) => (
            <h1 className="text-[13px] font-semibold text-text-primary mt-2 mb-1">{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-[12px] font-semibold text-text-primary mt-2 mb-1">{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-[11px] font-semibold text-text-primary mt-2 mb-1 uppercase tracking-wide">{children}</h3>
          ),
          p: ({ children }) => (
            <p className="text-[12px] leading-[1.55] text-text-primary mb-2 last:mb-0">{children}</p>
          ),
          ul: ({ children }) => (
            <ul className="text-[12px] leading-[1.55] text-text-primary mb-2 list-disc pl-4 space-y-0.5">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="text-[12px] leading-[1.55] text-text-primary mb-2 list-decimal pl-4 space-y-0.5">{children}</ol>
          ),
          li: ({ children }) => <li className="text-[12px]">{children}</li>,
          strong: ({ children }) => (
            <strong className="font-semibold text-text-primary">{children}</strong>
          ),
          em: ({ children }) => <em className="italic text-text-primary">{children}</em>,
          code: ({ children }) => (
            <code className="text-[11px] font-mono px-1 py-0.5 rounded bg-surface-secondary text-text-primary">
              {children}
            </code>
          ),
          pre: ({ children }) => (
            <pre className="text-[11px] font-mono p-2 my-2 rounded bg-surface-secondary text-text-primary overflow-x-auto">
              {children}
            </pre>
          ),
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer noopener"
              className="text-[var(--color-ai)] underline decoration-dotted underline-offset-2"
            >
              {children}
            </a>
          ),
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-[var(--color-ai)] pl-2 my-2 text-text-secondary italic">
              {children}
            </blockquote>
          ),
          table: ({ children }) => (
            <div className="overflow-x-auto mb-2">
              <table className="text-[11px] w-full border-collapse">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="text-left font-semibold p-1 border-b border-separator">{children}</th>
          ),
          td: ({ children }) => <td className="p-1 border-b border-separator">{children}</td>,
        }}
      >
        {state.markdown}
      </ReactMarkdown>
    );
  }, [state]);

  return (
    <div className="flex-1 min-h-0 overflow-hidden">
      <ScrollArea className="h-full" viewportClassName="px-3 py-3">
        {state.status === 'idle' && (
          <EmptyState pendingQueryDraft={pendingQueryDraft} />
        )}
        {state.status === 'pending' && <PendingState query={state.query} />}
        {state.status === 'ready' && (
          <article className="text-[12px] text-text-primary">
            <div className="text-[10px] uppercase tracking-wide text-[var(--color-ai)] mb-2 inline-flex items-center gap-1">
              <Sparkles size={9} className="ai-glow-pulse" />
              <span>Answer</span>
            </div>
            {markdownNode}
          </article>
        )}
        {state.status === 'error' && (
          <ErrorState query={state.query} message={state.message} />
        )}
      </ScrollArea>
    </div>
  );
}

function EmptyState({ pendingQueryDraft }: { pendingQueryDraft: string }) {
  const hasDraft = pendingQueryDraft.trim().length > 0;
  return (
    <div className="text-[12px] text-text-secondary">
      {hasDraft ? (
        <p>
          Press <span className="font-mono text-text-primary">Enter</span> to ask
          about the photo.
        </p>
      ) : (
        <>
          <p className="mb-1.5">Ask a question about the photo.</p>
          <ul className="list-disc pl-4 text-[11px] space-y-0.5">
            <li>“What's the dominant light source?”</li>
            <li>“Why does the sky look flat?”</li>
            <li>“What's making it feel cold?”</li>
          </ul>
        </>
      )}
    </div>
  );
}

function PendingState({ query }: { query: string }) {
  return (
    <div className="inline-flex items-center gap-1.5 text-[12px] text-text-secondary">
      <Loader2 size={12} className="animate-spin text-[var(--color-ai)]" />
      <span>
        Answering <span className="text-text-primary">“{query}”</span>…
      </span>
    </div>
  );
}

function ErrorState({ query, message }: { query: string; message: string }) {
  return (
    <div className="flex items-start gap-2 text-[12px] text-text-primary">
      <AlertCircle size={12} className="mt-[2px] flex-none text-[var(--color-danger,#e5484d)]" />
      <div className="flex-1 min-w-0">
        <div>{message}</div>
        <div className="text-[10px] text-text-secondary mt-0.5">
          Question: <span className="text-text-primary">“{query}”</span>
        </div>
        <div className="text-[10px] text-text-secondary mt-1">Press Enter to retry.</div>
      </div>
    </div>
  );
}

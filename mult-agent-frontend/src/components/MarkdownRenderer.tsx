import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import type { Components } from "react-markdown";

interface Props {
  content: string;
}

const ANSI_RE = /(?:\x1b)?\[[0-9;]*m/g;

export default function MarkdownRenderer({ content }: Props) {
  if (!content) return null;

  const clean = ANSI_RE.test(content) ? content.replace(ANSI_RE, "") : content;

  const components: Components = {
    code({ className, children, ...rest }) {
      const match = /language-(\w+)/.exec(className || "");
      const codeStr = String(children).replace(/\n$/, "");
      if (match) {
        return (
          <SyntaxHighlighter
            style={oneDark}
            language={match[1]}
            PreTag="div"
            customStyle={{
              margin: 0,
              borderRadius: 8,
              background: "rgba(0,0,0,0.4)",
              border: "1px solid rgba(255,255,255,0.06)",
              fontSize: 13,
            }}
          >
            {codeStr}
          </SyntaxHighlighter>
        );
      }
      return (
        <code className="text-amber-300 bg-amber-500/10 rounded px-1 py-0.5 text-xs" {...rest}>
          {children}
        </code>
      );
    },
    p({ children }) {
      return <p className="text-[var(--text-secondary)] leading-relaxed">{children}</p>;
    },
    h1({ children }) {
      return <h1 className="text-[var(--text-primary)] font-bold text-lg mt-4 mb-2">{children}</h1>;
    },
    h2({ children }) {
      return <h2 className="text-[var(--text-primary)] font-semibold text-base mt-3 mb-1.5">{children}</h2>;
    },
    h3({ children }) {
      return <h3 className="text-[var(--text-secondary)] font-medium text-sm mt-2 mb-1">{children}</h3>;
    },
    ul({ children }) {
      return <ul className="list-disc list-inside text-[var(--text-secondary)] space-y-0.5">{children}</ul>;
    },
    ol({ children }) {
      return <ol className="list-decimal list-inside text-[var(--text-secondary)] space-y-0.5">{children}</ol>;
    },
    strong({ children }) {
      return <strong className="text-[var(--text-primary)] font-semibold">{children}</strong>;
    },
    blockquote({ children }) {
      return (
        <blockquote className="border-l-2 border-amber-500/30 pl-3 italic text-[var(--text-muted)]">
          {children}
        </blockquote>
      );
    },
  };

  return (
    <div className="prose prose-sm max-w-none prose-invert">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {clean}
      </ReactMarkdown>
    </div>
  );
}

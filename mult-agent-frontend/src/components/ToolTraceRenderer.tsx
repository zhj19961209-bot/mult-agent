import { useState } from "react";
import { ChevronRight, Wrench } from "lucide-react";

interface ToolCall {
  server: string;
  tool: string;
  args: string;
  result: string;
}

type Segment =
  | { kind: "text"; content: string }
  | { kind: "tool"; call: ToolCall };

const ARROW_OUT = "→ ";
const ARROW_IN = "← ";
const HEADER_RE = /^→ ([^:]+)::([^(]+)\(([\s\S]*?)\)\s*$/;

function parse(text: string): Segment[] {
  const lines = text.split("\n");
  const segs: Segment[] = [];
  let textBuf: string[] = [];

  const flushText = () => {
    if (textBuf.length === 0) return;
    const content = textBuf.join("\n").replace(/\n+$/, "");
    if (content) segs.push({ kind: "text", content });
    textBuf = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith(ARROW_OUT)) {
      const m = line.match(HEADER_RE);
      if (m) {
        // Collect result lines (any number of ← lines, until a non-← line)
        const resultLines: string[] = [];
        let j = i + 1;
        while (j < lines.length && lines[j].startsWith(ARROW_IN)) {
          resultLines.push(lines[j].slice(ARROW_IN.length));
          j++;
        }
        flushText();
        segs.push({
          kind: "tool",
          call: {
            server: m[1],
            tool: m[2],
            args: m[3],
            result: resultLines.join("\n"),
          },
        });
        i = j - 1;
        continue;
      }
    }
    textBuf.push(line);
  }
  flushText();
  return segs;
}

function ToolCallCard({ call }: { call: ToolCall }) {
  const [open, setOpen] = useState(false);
  let prettyArgs = call.args;
  try {
    prettyArgs = JSON.stringify(JSON.parse(call.args), null, 2);
  } catch {
    // not JSON, leave as-is
  }
  return (
    <div className="my-1.5 rounded-md border border-amber-500/20 bg-amber-500/[0.03] overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full px-2.5 py-1.5 flex items-center gap-2 text-left text-[11px] hover:bg-amber-500/[0.05]"
      >
        <ChevronRight
          size={11}
          className={`text-amber-400/70 transition-transform ${open ? "rotate-90" : ""}`}
        />
        <Wrench size={11} className="text-amber-400/80" />
        <span className="text-amber-300 font-mono">{call.server}</span>
        <span className="text-amber-400/40">::</span>
        <span className="text-amber-200 font-mono">{call.tool}</span>
        <span className="text-amber-400/40 truncate">({call.args.slice(0, 80)}{call.args.length > 80 ? "…" : ""})</span>
      </button>
      {open && (
        <div className="px-2.5 pb-2 pt-1 border-t border-amber-500/10 space-y-1.5">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-amber-400/60 mb-0.5">arguments</div>
            <pre className="text-[10px] text-amber-100/80 whitespace-pre-wrap break-all m-0 font-mono">{prettyArgs}</pre>
          </div>
          {call.result && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-amber-400/60 mb-0.5">result</div>
              <pre className="text-[10px] text-[var(--text-secondary)] whitespace-pre-wrap break-all m-0 font-mono">{call.result}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface Props {
  text: string;
  className?: string;
}

export default function ToolTraceRenderer({ text, className = "" }: Props) {
  const segments = parse(text);
  const hasTool = segments.some((s) => s.kind === "tool");
  if (!hasTool) {
    return <pre className={`whitespace-pre-wrap break-all m-0 ${className}`}>{text}</pre>;
  }
  return (
    <div className={className}>
      {segments.map((s, i) =>
        s.kind === "text" ? (
          <pre key={i} className="whitespace-pre-wrap break-all m-0">{s.content}</pre>
        ) : (
          <ToolCallCard key={i} call={s.call} />
        )
      )}
    </div>
  );
}

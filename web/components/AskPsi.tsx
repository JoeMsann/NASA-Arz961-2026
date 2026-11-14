"use client";
import { Fragment, ReactNode, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";

interface Msg { role: "user" | "assistant"; content: string; steps?: any[]; citations?: any[]; warning?: string; evidence?: any[]; notice?: string }
const EXAMPLES = [
  "Which tests ran above 30% O2, what happened?",
  "How many solid-fuel tests exist below 18% oxygen, and from which investigations?",
  "What did the crew observe when nitrogen was used to suppress a flame?",
  "Which investigations shared the same hardware, and what did each burn?",
];

// Renders [label](https://…) links and line breaks. Everything else is shown as plain text.
function rich(text: string): ReactNode {
  return text.split("\n").map((line, i) => (
    <Fragment key={i}>
      {line.split(/(\[[^\]]+\]\(https?:\/\/[^)\s]+\))/g).map((part, k) => {
        const m = part.match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/);
        return m ? <a key={k} href={m[2]} target="_blank" rel="noreferrer">{m[1]}</a> : part.replace(/\*\*/g, "");
      })}
      <br />
    </Fragment>
  ));
}

export default function AskPsi({ seed, onSeedUsed }: { seed: string; onSeedUsed: () => void }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  async function send(text: string) {
    if (!text.trim() || busy) return;
    const history: Msg[] = [...msgs, { role: "user", content: text }];
    setMsgs(history); setQ(""); setBusy(true);
    try {
      const r = await api("agent", "chat", { messages: history.slice(-8).map(({ role, content }) => ({ role, content })) });
      setMsgs([...history, { role: "assistant", content: r.answer, steps: r.steps, citations: r.citations, warning: r.warning }]);
    } catch (e: any) {
      // No key or model failure: still show the evidence the search tool finds.
      const ev = await api("agent", `search?q=${encodeURIComponent(text)}`).catch(() => null);
      setMsgs([...history, { role: "assistant", content: "", notice: `${e.message} Showing matching evidence without a written answer.`, evidence: ev?.results ?? [] }]);
    }
    setBusy(false);
  }
  useEffect(() => { if (seed) { send(seed); onSeedUsed(); } }, [seed]);   // question handed over from the navigator
  useEffect(() => { end.current?.scrollIntoView({ block: "nearest" }); }, [msgs, busy]);

  return (
    <div className="grid">
      <div className="card">
        <h2>Ask PSI</h2>
        <p className="note">An agent with two tools: SQL over the unified test table, and search over investigation notes and NASA technical reports. Each answer shows the tool calls behind it.</p>
        <div className="row" style={{ marginTop: 8 }}>{EXAMPLES.map((e) => <button key={e} className="ghost" onClick={() => send(e)}>{e}</button>)}</div>
      </div>

      {msgs.map((m, i) => m.role === "user" ? <div key={i} className="msg me">{m.content}</div> : (
        <div key={i} className="card msg">
          {m.notice && <div className="warnline">{m.notice}</div>}
          {m.warning && <div className="warnline">{m.warning}</div>}
          {m.content && <div>{rich(m.content)}</div>}
          {m.citations && m.citations.length > 0 && (
            <div className="row" style={{ marginTop: 8 }}>
              <span className="note">{m.citations.every((c) => c.source === "tools") ? "Records the tools returned:" : "Cited:"}</span>
              {m.citations.map((c) => c.url
                ? <a key={c.ref} className="tag" href={c.url} target="_blank" rel="noreferrer">{c.ref} · {c.title}</a>
                : <span key={c.ref} className="tag" title="No DOI on record for this investigation">{c.ref} · {c.title} · no DOI on record</span>)}
            </div>
          )}
          {m.steps && m.steps.length > 0 && (
            <details><summary>{m.steps.length} tool call{m.steps.length > 1 ? "s" : ""}</summary>
              {m.steps.map((s, k) => (
                <div key={k} className="step">
                  <b>{s.tool}</b>
                  <pre>{s.args.query}</pre>
                  {s.result.error ? <div className="warnline">{s.result.error}</div>
                    : s.result.rows ? <div className="note">{s.result.rows.length} row{s.result.rows.length === 1 ? "" : "s"}{s.result.truncated ? " (truncated)" : ""}: {s.result.columns.join(", ")}</div>
                    : <div className="note">{(s.result.results ?? []).length} results{s.result.note ? `. ${s.result.note}` : ""}</div>}
                </div>
              ))}
            </details>
          )}
          {m.evidence && (m.evidence.length ? (
            <table><tbody>{m.evidence.map((e, k) => <tr key={k}><td><b>{e.url ? <a href={e.url} target="_blank" rel="noreferrer">{e.ref}</a> : e.ref}</b> <span className="tag">{e.kind}</span><div className="note">{e.text}</div></td></tr>)}</tbody></table>
          ) : <div className="note">No matching evidence.</div>)}
        </div>
      ))}
      {busy && <div className="card msg note">Querying the table and reports…</div>}
      <div ref={end} />

      <div className="row ask">
        <input type="text" value={q} placeholder="Ask about tests, conditions, outcomes…" aria-label="Question" onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send(q)} />
        <button className="pri" disabled={busy} onClick={() => send(q)}>Ask</button>
      </div>
    </div>
  );
}

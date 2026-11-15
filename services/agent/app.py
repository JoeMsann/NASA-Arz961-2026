"""Agent service: Ask PSI chat (LangGraph + Groq) and a no-LLM evidence search."""
import json, os, re, sqlite3
from fastapi import FastAPI, HTTPException
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
from pydantic import BaseModel, Field
import tools
from graph import groq_graph

app = FastAPI(title="Flame in Freefall - agent service")
_graph = None


class Turn(BaseModel):
    role: str
    content: str = Field(max_length=4000)


class ChatIn(BaseModel):
    messages: list[Turn] = Field(min_length=1, max_length=12)


class SqlIn(BaseModel):
    query: str = Field(max_length=4000)


def graph():
    global _graph
    if _graph is None:
        if not os.environ.get("GROQ_API_KEY"):
            raise HTTPException(503, "GROQ_API_KEY is not set. Add it to .env and restart the agent service.")
        _graph = groq_graph()
    return _graph


def citations(text: str, steps: list[dict]) -> list[dict]:
    """Investigations and reports the answer names, resolved to links from the database or tool output."""
    con = sqlite3.connect(f"file:{tools.DB}?mode=ro", uri=True)
    inv = {r[0]: {"ref": r[0], "title": r[1], "url": r[2]} for r in con.execute("select psi, name, doi_url from investigations where psi is not null")}
    con.close()
    found = {p: {**inv[p], "source": "answer"} for p in re.findall(r"(?:PSI|NTRS)-\d+", text) if p in inv}
    for s in steps:
        if s["tool"] == "search_reports":
            for r in (s["result"].get("results") or []):
                m = re.match(r"NTRS (\d+)", r["ref"])
                if m and m.group(1) in text:
                    found[r["ref"]] = {"ref": r["ref"], "title": r["text"][:90], "url": r["url"], "source": "answer"}
    # The model sometimes forgets to cite. Then list every PSI or NTRS record its tool calls returned, marked as such,
    # so the reader can still trace the answer.
    if not found:
        for s in steps:
            blob = json.dumps(s["result"].get("rows") or s["result"].get("results") or [])
            for p in re.findall(r"(?:PSI|NTRS)-\d+", blob):
                if p in inv:
                    found.setdefault(p, {**inv[p], "source": "tools"})
    return list(found.values())


_LINK = re.compile(r"\[([^\]]+)\]\(([^)\s]+)\)")   # any target: the model also writes [PSI-26](PSI-26) when there is no DOI


def fix_links(text: str, steps: list[dict]) -> tuple[str, int]:
    """Keep only links the tools actually returned. A model can attach an invented URL to a real PSI id, so a link whose
    label is a known id is rewritten to that record's link from the database, and any other link survives only if its
    URL appears in a tool result. Returns the cleaned text and how many links were changed or removed."""
    con = sqlite3.connect(f"file:{tools.DB}?mode=ro", uri=True)
    known = {r[0]: r[1] for r in con.execute("select psi, doi_url from investigations where psi is not null")}
    con.close()
    seen = json.dumps([s["result"] for s in steps])
    changed = 0

    def swap(m):
        nonlocal changed
        label, url = m.group(1), m.group(2)
        ids = re.findall(r"(?:PSI|NTRS)-\d+", label)
        if ids and ids[0] in known:
            good = known[ids[0]]
            if good == url:
                return m.group(0)
            changed += 1
            return f"[{label}]({good})" if good else label
        if url.startswith("http") and url.rstrip("/.,") in seen:
            return m.group(0)
        changed += 1
        return label
    return _LINK.sub(swap, text), changed


def run_chat(g, turns: list[Turn]) -> dict:
    msgs = [HumanMessage(t.content) if t.role == "user" else AIMessage(t.content) for t in turns]
    out = g.invoke({"messages": msgs}, {"recursion_limit": 12})["messages"][len(msgs):]
    calls, steps = {}, []
    for m in out:
        if isinstance(m, AIMessage):
            for c in m.tool_calls or []:
                calls[c["id"]] = c
        elif isinstance(m, ToolMessage):
            c = calls.get(m.tool_call_id, {})
            try:
                res = json.loads(m.content)
            except (TypeError, ValueError):
                res = {"error": str(m.content)[:500]}
            steps.append({"tool": c.get("name", m.name), "args": c.get("args", {}), "result": res})
    answer = next((m.content for m in reversed(out) if isinstance(m, AIMessage) and m.content and not m.tool_calls), "")
    if not answer:
        answer = "I could not finish an answer within the step limit. The tool results are listed below."
    answer, fixed = fix_links(answer, steps)
    cites = citations(answer, steps)
    warn = None
    if not steps:
        warn = "No tool was called, so this answer is not grounded in the dataset. Treat it as unverified."
    elif cites and all(c["source"] == "tools" for c in cites):
        warn = "The answer did not cite its sources. The records its tool calls returned are listed instead."
    elif not cites:
        warn = "No PSI or NTRS record could be linked to this answer. Check the tool calls below."
    if fixed:
        note = f"{fixed} link{'s' if fixed > 1 else ''} in the answer did not match the dataset and {'were' if fixed > 1 else 'was'} corrected or removed."
        warn = f"{warn} {note}" if warn else note
    return {"answer": answer, "steps": steps, "citations": cites, "warning": warn}


@app.get("/health")
def health():
    return {"ok": True, "llm_configured": bool(os.environ.get("GROQ_API_KEY")),
            "model": os.environ.get("GROQ_MODEL", "qwen/qwen3.8-27b")}


@app.post("/chat")
def chat(body: ChatIn):
    if body.messages[-1].role != "user":
        raise HTTPException(400, "Last message must come from the user.")
    g = graph()
    for attempt in (1, 2, 3):
        try:
            return run_chat(g, body.messages)
        except HTTPException:
            raise
        except Exception as e:
            msg = str(e)
            if "tool_use_failed" in msg and attempt < 3:
                continue            # the model emitted a malformed tool call (wrong tool or argument name); run again
            if "rate_limit" in msg or "Request too large" in msg or "429" in msg or "413" in msg:
                raise HTTPException(503, "The language model's rate limit was reached. Wait a minute and ask again, or ask a narrower question.")
            raise HTTPException(502, f"Agent run failed: {type(e).__name__}: {msg[:300]}")


@app.get("/search")
def search(q: str):
    """Evidence search without the language model. The UI falls back to this when no key is set."""
    return tools.search_all(q)


@app.post("/sql")
def sql(body: SqlIn):
    """Read-only SQL without the language model, for the MCP service. Same guard and row limit as the agent's own tool."""
    return tools.run_sql(body.query)


@app.get("/schema")
def schema():
    return {"schema": tools.SCHEMA}

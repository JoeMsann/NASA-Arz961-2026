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
    inv = {r[0]: {"ref": r[0], "title": r[1], "url": r[2]} for r in con.execute("select psi, name, doi_url from investigations")}
    con.close()
    found = {p: inv[p] for p in re.findall(r"(?:PSI|NTRS)-\d+", text) if p in inv}
    for s in steps:
        if s["tool"] == "search_reports":
            for r in (s["result"].get("results") or []):
                m = re.match(r"NTRS (\d+)", r["ref"])
                if m and m.group(1) in text:
                    found[r["ref"]] = {"ref": r["ref"], "title": r["text"][:90], "url": r["url"]}
    return list(found.values())


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
    warn = None if steps else "No tool was called, so this answer is not grounded in the dataset. Treat it as unverified."
    return {"answer": answer, "steps": steps, "citations": citations(answer, steps), "warning": warn}


@app.get("/health")
def health():
    return {"ok": True, "llm_configured": bool(os.environ.get("GROQ_API_KEY")),
            "model": os.environ.get("GROQ_MODEL", "qwen/qwen3.8-27b")}


@app.post("/chat")
def chat(body: ChatIn):
    if body.messages[-1].role != "user":
        raise HTTPException(400, "Last message must come from the user.")
    g = graph()
    try:
        return run_chat(g, body.messages)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"Agent run failed: {type(e).__name__}: {str(e)[:300]}")


@app.get("/search")
def search(q: str):
    """Evidence search without the language model. The UI falls back to this when no key is set."""
    return tools.search_all(q)


@app.get("/schema")
def schema():
    return {"schema": tools.SCHEMA}

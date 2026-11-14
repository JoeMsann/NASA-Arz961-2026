"""Offline test: a scripted stand-in for the LLM drives the real graph and the real tools.

  cd services/agent && python test_graph.py
"""
import json
from langchain_core.messages import AIMessage
from langchain_core.runnables import RunnableLambda
import tools
from graph import build_graph
from app import run_chat, Turn

SQL = ("select t.test_id, t.investigation, t.psi_id, t.fuel, t.o2_pct, t.pressure_psia, t.outcome "
       "from tests t where t.kind='test' and t.o2_pct > 30 order by t.o2_pct desc")


def scripted(messages):
    n_tool = sum(1 for m in messages if m.type == "tool")
    if n_tool == 0:
        return AIMessage("", tool_calls=[{"name": "sql_query", "args": {"query": SQL}, "id": "c1", "type": "tool_call"}])
    if n_tool == 1:
        return AIMessage("", tool_calls=[{"name": "search_reports", "args": {"query": "FLEX droplet extinction oxygen"}, "id": "c2", "type": "tool_call"}])
    return AIMessage("Tests above 30% O2 are FLEX droplet burns [PSI-69](https://doi.org/10.60555/mbq8-0451).")


if __name__ == "__main__":
    assert "error" in tools.run_sql("delete from tests")
    assert "error" in tools.run_sql("select 1; drop table tests")
    assert tools.run_sql("select count(*) from tests")["rows"][0][0] > 900

    out = run_chat(build_graph(RunnableLambda(scripted)), [Turn(role="user", content="Which tests ran above 30% O2, what happened?")])
    assert [s["tool"] for s in out["steps"]] == ["sql_query", "search_reports"], out["steps"]
    rows = out["steps"][0]["result"]["rows"]
    assert rows and all(r[4] > 30 for r in rows)
    assert out["citations"] and out["citations"][0]["ref"] == "PSI-69"
    print("graph ok:", len(rows), "rows above 30% O2;", "search hits:", len(out["steps"][1]["result"]["results"]),
          "; note:", out["steps"][1]["result"]["note"])
    print("citations:", out["citations"])
    assert out["citations"][0]["source"] == "answer" and out["warning"] is None

    # An answer that forgets to cite still gets the records its tool calls returned, with a warning.
    def uncited(messages):
        m = scripted(messages)
        return m if m.tool_calls else AIMessage("Only droplet tests ran above 30% oxygen.")
    out = run_chat(build_graph(RunnableLambda(uncited)), [Turn(role="user", content="Which tests ran above 30% O2?")])
    assert out["citations"] and all(c["source"] == "tools" for c in out["citations"]), out["citations"]
    assert out["warning"] and "did not cite" in out["warning"]

    # Hardware and sensors are searchable, and investigations without a PSI id do not break the index.
    hits = tools.search_local("glovebox flow duct hardware")
    assert hits and any("Glovebox" in h["text"] for h in hits[:3]), hits
    hits = tools.search_local("electric field partial gravity")
    assert hits and hits[0]["ref"] == "ACME-E-FIELD", hits
    hw = tools.run_sql("select id, psi, hardware from investigations where hardware like '%MDCA%' order by id")
    assert [r[0] for r in hw["rows"]] == ["CFI", "FLEX", "FLEX-2"], hw
    print("fallback citations, hardware search and investigations columns ok")

    # Seen in a live run: the model attached one invented DOI to every PSI id. Links are rewritten from the database.
    def bad_links(messages):
        m = scripted(messages)
        return m if m.tool_calls else AIMessage("FLEX [PSI-69](https://doi.org/10.2514/6.2014-1000), BASS [PSI-26](https://doi.org/10.2514/6.2014-1000), "
                                                "see [a paper](https://example.org/made-up).")
    out = run_chat(build_graph(RunnableLambda(bad_links)), [Turn(role="user", content="Which tests ran above 30% O2?")])
    assert "[PSI-69](https://doi.org/10.60555/mbq8-0451)" in out["answer"], out["answer"]
    assert "10.2514" not in out["answer"] and "example.org" not in out["answer"] and "BASS PSI-26," in out["answer"], out["answer"]
    assert "3 links" in out["warning"], out["warning"]

    # What the model sees is clipped to fit a small token budget, and says when rows were dropped.
    full = tools.run_sql("select test_id, notes from tests where investigation = 'BASS'")
    fit = tools._fit_sql(full)
    assert len(json.dumps(fit)) < tools.SQL_CHARS + 600 and fit["truncated"] and "COUNT(*)" in fit["note"]
    assert max(len(str(c)) for r in fit["rows"] for c in r) <= tools.CELL + 1
    small = tools._fit_sql(tools.run_sql("select count(*) from tests"))
    assert small["rows"][0][0] > 900 and not small["truncated"] and "note" not in small
    print("link repair and result clipping ok")

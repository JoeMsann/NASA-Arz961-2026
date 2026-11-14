"""End-to-end test: a real MCP client connects over HTTP, calls every tool and checks the answers against the ml service.

Needs the three services running (docker compose up, or the uvicorn commands in setup.md).

  cd services/mcp && python test_mcp.py                      # http://localhost:8003/mcp, ml on http://localhost:8001
  cd services/mcp && python test_mcp.py <mcp url> <ml url>
"""
import asyncio, json, sys
import httpx
from mcp import Client

URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8003/mcp"
ML = sys.argv[2] if len(sys.argv) > 2 else "http://localhost:8001"


async def main():
    ml = httpx.Client(base_url=ML, timeout=30)
    async with Client(URL) as c:
        async def tool(name, **args):
            r = await c.call_tool(name, args)
            assert not r.is_error, f"{name}: {r.content[0].text}"
            return r.structured_content

        async def fails(name, **args):
            r = await c.call_tool(name, args)
            assert r.is_error, f"{name} should have failed with {args}"
            return r.content[0].text

        tools = {t.name: t for t in (await c.list_tools()).tools}
        assert len(tools) == 10 and all(t.annotations.read_only_hint for t in tools.values()), list(tools)
        print("connected:", c.server_info.name, "| protocol", c.protocol_version, "|", len(tools), "tools, all read-only")

        # catalog and table: the same data the ml service gives the web interface
        inv = (await tool("list_investigations"))["investigations"]
        assert inv == ml.get("/catalog").json()
        total = ml.get("/health").json()["tests"]
        assert (await tool("search_tests", limit=1))["total"] == total
        flex = await tool("search_tests", investigation="FLEX", limit=5)
        assert flex == ml.get("/tests", params={"investigation": "FLEX", "limit": 5}).json()
        assert len(flex["rows"]) == 5 and all(r["psi_id"] == "PSI-69" and r["provenance"] for r in flex["rows"])
        assert "limit" in await fails("search_tests", limit=5000)
        print("table ok:", len(inv), "investigations,", total, "rows,", flex["total"], "FLEX rows")

        # SQL: counts agree with the table, writes and runaway queries are refused
        assert "tests(" in (await tool("get_table_schema"))["schema"]
        by_kind = dict((await tool("sql_query", query="select kind, count(*) from tests group by kind"))["rows"])
        assert by_kind == ml.get("/report").json()["rows"]["by_kind"], by_kind
        many = await tool("sql_query", query="select test_id, investigation, psi_id from tests")
        assert len(many["rows"]) == 40 and many["truncated"] and "note" in many
        assert "SELECT" in await fails("sql_query", query="delete from tests")
        assert "no such column" in await fails("sql_query", query="select nope from tests")
        assert "interrupted" in await fails("sql_query", query="with recursive n(x) as (select 1 union all select x + 1 from n) select count(*) from n")
        print("sql ok:", by_kind)

        # evidence search (the NTRS half needs internet; the note says so when it is unreachable)
        ev = await tool("search_evidence", query="nitrogen flame extinguish")
        assert ev["results"] and all(r["ref"] and "url" in r for r in ev["results"])
        print("search ok:", len(ev["results"]), "results; note:", ev["note"])

        # navigator and compare: identical to the ml service apart from the chart coordinates
        envs = (await tool("list_environments"))["environments"]
        for e in envs:
            body = {k: e[k] for k in ("o2_pct", "pressure_psia", "gravity_g")}
            got, want = await tool("check_environment_coverage", **body), ml.post("/navigator", json=body).json()
            want.pop("points")
            assert got == want and "points" not in got, e["id"]
        iss = await tool("check_environment_coverage", o2_pct=21, pressure_psia=14.7)
        suit = await tool("check_environment_coverage", o2_pct=100, pressure_psia=4.3)
        assert iss["covered"] and not suit["covered"]
        assert "o2_pct" in await fails("check_environment_coverage", o2_pct=150, pressure_psia=14.7)
        cmp_ = await tool("compare_investigations", a="BASS", b="SAFFIRE-II")
        want = ml.get("/compare", params={"a": "BASS", "b": "SAFFIRE-II"}).json()
        assert cmp_["similarities"] == want["similarities"] and cmp_["differences"] == want["differences"]
        assert cmp_["a"]["numeric"] == want["a"]["numeric"] and "points" not in cmp_["a"]
        assert "Unknown investigation" in await fails("compare_investigations", a="BASS", b="NOPE")
        print("navigator ok:", len(envs), "presets; ISS covered:", iss["covered"], "| spacesuit covered:", suit["covered"])
        print("compare ok:", len(cmp_["similarities"]), "similarities,", len(cmp_["differences"]), "differences")

        # predictor: same numbers as the ml service, and extrapolation is flagged
        body = {"fuel": "Heptane", "o2_pct": 21, "pressure_psia": 14.7, "co2_pct": 0, "he_pct": 0, "d0_mm": 3}
        p, want = await tool("predict_droplet_flame", **body), ml.post("/predict", json=body).json()
        assert p["extinction"] == want["extinction"] and p["burn_rate"] == want["burn_rate"] and p["nearest"] == want["nearest"]
        assert not p["extrapolating"] and "warning" not in p
        assert p["flame"]["out"]["d_end"] == want["flame"]["out"]["d_end"] and p["flame"]["burnout"]["t_end"] == want["flame"]["burnout"]["t_end"]
        assert "t" not in p["flame"]["out"] and "lum" not in p["flame"]["burnout"]
        far = await tool("predict_droplet_flame", fuel="Methanol", o2_pct=100, pressure_psia=4.3)
        assert far["extrapolating"] and far["outside"] and "extrapolation" in far["warning"]
        assert "fuel must be one of" in await fails("predict_droplet_flame", fuel="Ethanol", o2_pct=21, pressure_psia=14.7)
        assert (await tool("get_build_report")) == ml.get("/report").json()
        print("predictor ok: heptane in air, extinction", round(p["extinction"]["mean"], 3), "| K", round(p["burn_rate"]["mean"], 3),
              "mm2/s | 100% O2 flagged as extrapolation:", [o["feature"] for o in far["outside"]])
        sizes = {n: len(json.dumps(await tool(n, **a))) for n, a in [("list_investigations", {}), ("search_tests", {}),
                 ("check_environment_coverage", {"o2_pct": 21, "pressure_psia": 14.7}), ("compare_investigations", {"a": "BASS", "b": "FLEX"}),
                 ("predict_droplet_flame", body), ("get_build_report", {})]}
        print("reply sizes (characters):", sizes)
    print("all ok")


if __name__ == "__main__":
    asyncio.run(main())

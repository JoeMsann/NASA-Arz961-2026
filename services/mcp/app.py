"""MCP service: lets any MCP-capable chatbot use the project's data and models as tools.

A thin layer over the other two services. Every tool forwards to an endpoint the web interface already uses, so a
chatbot sees the same numbers as the dashboard. Nothing is computed or stored here.

  cd services/mcp && uvicorn app:app --port 8003        # endpoint: http://localhost:8003/mcp

The log (docker compose logs -f mcp) shows one line per event: a new client, a tool list, a tool call, its answer.
Set MCP_LOG_JSON=1 to also print every JSON message received and sent. Set NO_COLOR=1 for plain text.
"""
import json, logging, os, time
from typing import Annotated, Any
import httpx
from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.server.transport_security import TransportSecuritySettings
from mcp.types import ToolAnnotations
from pydantic import Field
from starlette.responses import JSONResponse

ML = os.environ.get("ML_URL", "http://localhost:8001").rstrip("/")
AGENT = os.environ.get("AGENT_URL", "http://localhost:8002").rstrip("/")

INSTRUCTIONS = """Flame in Freefall: NASA microgravity combustion data (the PSI database) for spacecraft fire safety.
A NASA Space Apps 2026 research aid. Nothing here is flight-safety guidance or material approval.

Rules for using the data:
- Answer data questions from tool results, not from memory. If the tools return nothing relevant, say the dataset does not cover it.
- Cite the PSI id and DOI link (or NTRS id and link) that the tools return.
- Rows with kind='planned' have no result. Rows with kind='threshold_1g' are ground tests, and their o2_pct is the
  limiting oxygen level found, not a test condition. Do not mix either with flown tests (kind='test') without saying so.
- A value named in a row's `assumed` column was added during cleaning and is not in the NASA table. Say so when you use it.
- The predictor covers heptane and methanol droplets in microgravity only. When it reports `extrapolating`, say so plainly."""

mcp = MCPServer("Flame in Freefall", instructions=INSTRUCTIONS, version="1.0.0")
READ = ToolAnnotations(read_only_hint=True, open_world_hint=False)
READ_WEB = ToolAnnotations(read_only_hint=True, open_world_hint=True)   # also searches the NASA Technical Reports Server

O2 = Annotated[float, Field(ge=5, le=100, description="Oxygen, percent by volume (5 to 100)")]
PRESSURE = Annotated[float, Field(ge=1, le=50, description="Total pressure, psi absolute (1 to 50). 14.7 = 1 atm")]


# ------------------------------------------------------------------ log
LOG_JSON = os.environ.get("MCP_LOG_JSON", "").lower() in ("1", "true", "yes", "on")
COLOR = not os.environ.get("NO_COLOR")
JSON_CHARS = 2000   # longest JSON message printed in full
STYLE = {"new": "1;32", "list": "36", "call": "1;33", "ok": "32", "error": "1;31", "service": "2", "other": "2", "json": "35"}
for _noisy in ("uvicorn.access", "httpx", "mcp"):   # this log replaces their per-request lines; warnings still show
    logging.getLogger(_noisy).setLevel(logging.WARNING)


def log(kind: str, label: str, text: str):
    line = f"{label:<11} {text}"
    print(f"{time.strftime('%H:%M:%S')}  " + (f"\033[{STYLE[kind]}m{line}\033[0m" if COLOR else line), flush=True)


def _size(n: int) -> str:
    return f"{n} B" if n < 1000 else f"{n / 1000:.1f} kB"


def _clip(text: str, n: int) -> str:
    return text if len(text) <= n else f"{text[:n]}... ({len(text)} characters)"


async def call(base: str, path: str, params: dict | None = None, body: dict | None = None, quiet: bool = False) -> Any:
    """One request to the ml or agent service. A failure becomes a ToolError: a plain sentence the chatbot is shown."""
    name, start = "ml" if base == ML else "agent", time.monotonic()
    try:
        async with httpx.AsyncClient(timeout=30) as c:
            if body is not None:
                r = await c.post(base + path, json=body)
            else:
                r = await c.get(base + path, params={k: v for k, v in (params or {}).items() if v is not None})
    except httpx.HTTPError as e:
        if not quiet:
            log("error", "  service", f"{name} {'POST' if body is not None else 'GET'} {path} -> no answer ({type(e).__name__})")
        raise ToolError(f"The {name} service did not answer ({type(e).__name__}). Check that it is running.") from None
    if not quiet:
        log("service" if r.status_code < 400 else "error", "  service",
                f"{name} {r.request.method} {path} -> {r.status_code} | {_size(len(r.content))} | {(time.monotonic() - start) * 1000:.0f} ms")
    if r.status_code >= 400:
        try:
            detail = r.json().get("detail")
        except ValueError:
            detail = r.text[:300]
        if isinstance(detail, list):   # FastAPI validation errors: one entry per bad field
            detail = "; ".join(f"{'.'.join(str(p) for p in d.get('loc', [])[1:])}: {d.get('msg')}" for d in detail)
        raise ToolError(f"The {name} service rejected the request ({r.status_code}): {detail}")
    return r.json()


# ------------------------------------------------------------------ catalog and table
@mcp.tool(title="List investigations", annotations=READ)
async def list_investigations() -> dict[str, Any]:
    """List every combustion investigation in the catalog (Saffire, BASS, FLEX, SAME, SPICE, ACME and others).

    Each entry has its id (use it in the other tools), PSI id, DOI link, fire-safety class (`tier`, 1 = most direct),
    fuels, objective, platform, hardware, sensors and `rows`, the number of test records loaded. Entries with rows = 0
    are descriptions only. `details_basis` says where hand-written hardware and sensor text came from."""
    return {"investigations": await call(ML, "/catalog")}


@mcp.tool(title="Browse the unified test table", annotations=READ)
async def search_tests(
    investigation: Annotated[str | None, Field(description="Investigation id from list_investigations, e.g. 'FLEX' or 'BASS-II'")] = None,
    phase: Annotated[str | None, Field(description="Fuel phase, e.g. 'solid' or 'liquid droplet'. Valid values come back in `facets`")] = None,
    kind: Annotated[str | None, Field(description="'test' = flown microgravity test, 'planned' = planned point with no result, "
                                                  "'threshold_1g' = 1-g ground flammability threshold")] = None,
    text: Annotated[str | None, Field(description="Words to find in the test id, fuel, notes, outcome or diluent")] = None,
    offset: Annotated[int, Field(ge=0, description="Rows to skip, for paging")] = 0,
    limit: Annotated[int, Field(ge=1, le=100, description="Rows to return (1 to 100)")] = 25,
) -> dict[str, Any]:
    """Page through the unified table of NASA combustion tests, with optional filters. Returns whole rows (all 21
    columns, including `assumed`, `source_file` and `provenance`), `total` matching rows and the valid filter values.

    Use this to read individual tests. For counts, ranges, grouping or filters on numbers, use sql_query instead."""
    return await call(ML, "/tests", {"investigation": investigation, "phase": phase, "kind": kind, "q": text,
                                     "offset": offset, "limit": limit})


@mcp.tool(title="Describe the SQL tables", annotations=READ)
async def get_table_schema() -> dict[str, Any]:
    """Describe the two SQLite tables behind sql_query (`tests` and `investigations`): columns, units and what the
    coded values mean. Call this once before writing SQL."""
    return await call(AGENT, "/schema")


@mcp.tool(title="Query the test table with SQL", annotations=READ)
async def sql_query(query: Annotated[str, Field(max_length=4000, description="One SQLite SELECT statement")]) -> dict[str, Any]:
    """Run one read-only SQLite SELECT over the unified test table (`tests`) and the catalog (`investigations`).
    Use it for counts, ranges, grouping and comparisons of test conditions and outcomes.

    Call get_table_schema first for the columns. Select test_id, investigation and psi_id so results can be cited.
    At most 40 rows come back; `truncated` says when more matched, so use COUNT(*) or GROUP BY for totals."""
    res = await call(AGENT, "/sql", body={"query": query})
    if "error" in res:
        raise ToolError(f"{res['error']} Call get_table_schema for the table and column names.")
    if res.get("truncated"):
        res["note"] = "Only the first 40 rows are shown; more matched. Do not report this as the total: use COUNT(*) or GROUP BY, or narrow the WHERE clause."
    return res


@mcp.tool(title="Search descriptions, crew notes and NASA reports", annotations=READ_WEB)
async def search_evidence(query: Annotated[str, Field(max_length=300, description="Plain words, e.g. 'why do flames go out at low flow'")]) -> dict[str, Any]:
    """Keyword search over investigation descriptions, free-text crew test notes, and a live search of the NASA
    Technical Reports Server (NTRS). Use it for what happened and why: explanations, mechanisms and background.

    Each result has a `ref` (PSI id or NTRS id), a `url` to cite and a `kind`. `note` says so when NTRS could not be
    reached and only local evidence is listed. NTRS results are report abstracts, not rows of the test table."""
    return await call(AGENT, "/search", {"q": query})


# ------------------------------------------------------------------ habitat navigator and compare
@mcp.tool(title="List habitat presets", annotations=READ)
async def list_environments() -> dict[str, Any]:
    """List the crewed-environment presets the dashboard uses (Earth, ISS, spacesuit, Moon base, rover, Mars habitat)
    with their oxygen, pressure and gravity. `basis` says where each value came from: several are the team's own
    scenarios, not NASA specifications. Pass the numbers to check_environment_coverage."""
    return {"environments": await call(ML, "/environments")}


@mcp.tool(title="Check what the data covers for an atmosphere", annotations=READ)
async def check_environment_coverage(
    o2_pct: O2, pressure_psia: PRESSURE,
    gravity_g: Annotated[float, Field(ge=0, le=1, description="Gravity in g (0 = microgravity, 0.166 = Moon, 0.38 = Mars, 1 = Earth)")] = 0,
) -> dict[str, Any]:
    """For one cabin atmosphere, report which flown microgravity tests lie close to it and which investigations are
    most relevant. This is the dashboard's Habitat Risk Navigator.

    `covered` is true when at least one flown test lies within 5 oxygen percentage points and 2 psi (the `rule`).
    `nearest` lists the closest tests, `ranking` orders investigations by closest test then fire-safety class, and
    `thresholds_1g` lists materials from White Sands 1-g ground tests that do or do not sustain burning at or below this
    oxygen level. Planned points and 1-g thresholds never count as coverage. `gravity_note` says how far the flight
    data applies at this gravity: the table holds no partial-gravity test."""
    res = await call(ML, "/navigator", body={"o2_pct": o2_pct, "pressure_psia": pressure_psia, "gravity_g": gravity_g})
    res.pop("points", None)   # every test's coordinates, for the web chart
    return res


@mcp.tool(title="Compare two investigations", annotations=READ)
async def compare_investigations(
    a: Annotated[str, Field(description="Investigation id from list_investigations, e.g. 'BASS'")],
    b: Annotated[str, Field(description="A second investigation id, e.g. 'SAFFIRE-II'")],
) -> dict[str, Any]:
    """Compare two investigations side by side: catalog text, statistics computed from each one's test rows (counts by
    kind, fuels, oxygen / pressure / flow ranges, outcomes, measured quantities, what was varied and what was held
    fixed), and `similarities` and `differences` written as sentences by fixed rules, not by a language model."""
    res = await call(ML, "/compare", {"a": a, "b": b})
    for side in ("a", "b"):
        res[side].pop("points", None)
    return res


# ------------------------------------------------------------------ flame predictor
SERIES = ("t", "d", "df", "fsr", "lum", "soot")   # per-frame arrays for the web animation


@mcp.tool(title="Predict a droplet flame", annotations=READ)
async def predict_droplet_flame(
    o2_pct: O2, pressure_psia: PRESSURE,
    fuel: Annotated[str, Field(description="'Heptane' or 'Methanol'. No other fuel is modelled")] = "Heptane",
    co2_pct: Annotated[float, Field(ge=0, le=80, description="Carbon dioxide in the atmosphere, percent")] = 0,
    he_pct: Annotated[float, Field(ge=0, le=80, description="Helium in the atmosphere, percent")] = 0,
    d0_mm: Annotated[float, Field(ge=0.5, le=6, description="Initial droplet diameter, mm")] = 3,
) -> dict[str, Any]:
    """Predict how a single heptane or methanol droplet burns in microgravity, from models trained on the FLEX
    experiment (PSI-69). Not a solid-material model and not valid in gravity.

    `extinction`: chance (0 to 1) that the flame goes out before the fuel is gone. `burn_rate`: burning-rate constant
    K in mm2/s. Each has `mean` and a 90% range (`lo`, `hi`) from a 40-member bootstrap ensemble.
    `flame`: the burn those numbers imply by the d-squared law, for both endings: `out` (self-extinction, with the
    droplet diameter left `d_end` in mm, taken from the closest FLEX runs that went out, listed in `from_runs`) and
    `burnout`; `t_end` is the burn time in seconds and `p` each ending's chance.
    `extrapolating` is true when an input is outside what FLEX tested; `outside` lists which, and the numbers are then
    extrapolation, not evidence. `nearest` lists the closest real FLEX runs and `scores` the cross-validated accuracy."""
    res = await call(ML, "/predict", body={"fuel": fuel, "o2_pct": o2_pct, "pressure_psia": pressure_psia,
                                           "co2_pct": co2_pct, "he_pct": he_pct, "d0_mm": d0_mm})
    for ending in ("out", "burnout"):
        if res.get("flame") and res["flame"].get(ending):
            res["flame"][ending] = {k: v for k, v in res["flame"][ending].items() if k not in SERIES}
    res["scores"] = {k: v for k, v in res["scores"].items() if k in ("extinction", "burn_rate", "validation", "shipped")}
    if res["extrapolating"]:
        res["warning"] = ("Outside the range FLEX tested (see `outside`). Treat every number here as extrapolation: "
                          "the narrow ranges reflect the model, not evidence.")
    return res


@mcp.tool(title="Data and model report", annotations=READ)
async def get_build_report() -> dict[str, Any]:
    """Report what the dataset holds and how good the models are: row counts by investigation, kind and provenance
    (`rows`), and cross-validated scores for the extinction and burning-rate models beside the alternatives tried."""
    return await call(ML, "/report")


class LogTraffic:
    """Wraps the web app and prints what passes through: who connected, what they asked for, what went back.
    It only reads the traffic; nothing is changed."""

    def __init__(self, app):
        self.app, self.seen = app, set()

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["path"] == "/health":   # health checks would drown the log
            return await self.app(scope, receive, send)
        head = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope["headers"]}
        chunks, more = [], True
        while more:   # the whole request body, so the JSON can be read before the app handles it
            m = await receive()
            if m["type"] != "http.request":
                break
            chunks.append(m.get("body", b""))
            more = m.get("more_body", False)
        raw, replayed = b"".join(chunks), False

        async def replay():
            nonlocal replayed
            if not replayed:
                replayed = True
                return {"type": "http.request", "body": raw, "more_body": False}
            return await receive()

        try:
            sent = json.loads(raw) if raw else None
        except ValueError:
            sent = None
        msgs = [m for m in (sent if isinstance(sent, list) else [sent]) if isinstance(m, dict)]
        asked = {m["id"]: m for m in msgs if "id" in m and "method" in m}
        # behind the tunnel the caller's address arrives in a header; otherwise it is the socket's
        ip = head.get("cf-connecting-ip") or head.get("x-forwarded-for", "").split(",")[0].strip() or (scope.get("client") or ["?"])[0]
        who = f"{ip}{' via tunnel' if 'cf-ray' in head else ''} | {head.get('user-agent', 'no user-agent')[:50]}"
        if LOG_JSON and raw:
            log("json", "  json in", _clip(raw.decode("utf-8", "replace"), JSON_CHARS))
        for m in msgs:
            self.request(m, who, (ip, head.get("user-agent")))
        if not msgs:
            log("other", "HTTP", f"{scope['method']} {scope['path']} | {who}")

        start, status, kind, out = time.monotonic(), 0, "", []

        async def watch(m):
            nonlocal status, kind
            if m["type"] == "http.response.start":
                status = m["status"]
                kind = dict(m.get("headers") or []).get(b"content-type", b"").decode("latin-1")
                if kind.startswith("text/event-stream"):
                    log("other", "STREAM", f"event stream opened | {who}")
            elif m["type"] == "http.response.body" and not kind.startswith("text/event-stream"):
                out.append(m.get("body", b""))
                if not m.get("more_body", False):
                    self.response(b"".join(out), asked, status, (time.monotonic() - start) * 1000, bool(msgs))
            await send(m)

        await self.app(scope, replay, watch)

    def request(self, m, who, caller):
        method, p = m.get("method"), m.get("params") or {}
        # a client names itself in its opening message (older protocol) or in every message (2026-07-28 protocol)
        info = p.get("clientInfo") or (p.get("_meta") or {}).get("io.modelcontextprotocol/clientInfo") or {}
        client = f"{info.get('name', 'unnamed client')} {info.get('version', '')}".strip() if info else None
        if method in ("initialize", "server/discover") or caller not in self.seen:
            self.seen.add(caller)
            version = p.get("protocolVersion") or (p.get("_meta") or {}).get("io.modelcontextprotocol/protocolVersion")
            log("new", "NEW CLIENT", " | ".join(x for x in (client, f"protocol {version}" if version else None, who) if x))
        if method == "tools/list":
            log("list", "LIST TOOLS", who)
        elif method == "tools/call":
            log("call", "CALL", f"{p.get('name')} {_clip(json.dumps(p.get('arguments') or {}), 300)}")
        elif method and method not in ("initialize", "server/discover"):
            log("other", "MESSAGE", method)

    def response(self, raw, asked, status, ms, is_mcp):
        tail = f"{_size(len(raw))} | {ms:.0f} ms"
        if LOG_JSON and raw and is_mcp:
            log("json", "  json out", _clip(raw.decode("utf-8", "replace"), JSON_CHARS))
        try:
            got = json.loads(raw) if raw else None
        except ValueError:
            got = None
        answers = [a for a in (got if isinstance(got, list) else [got]) if isinstance(a, dict)]
        if not is_mcp or not answers:
            if status >= 400:
                log("error", "HTTP", f"status {status} | {tail}")
            elif not is_mcp:
                log("other", "  reply", f"status {status} | {tail}")
            return
        for a in answers:
            method = (asked.get(a.get("id")) or {}).get("method")
            name = ((asked.get(a.get("id")) or {}).get("params") or {}).get("name")
            res = a.get("result") or {}
            if "error" in a:
                log("error", "ERROR", f"{name or method or 'request'} | {a['error'].get('message')} | {tail}")
            elif method == "tools/call" and res.get("isError"):
                said = " ".join(c.get("text", "") for c in res.get("content") or [] if c.get("type") == "text")
                log("error", "ERROR", f"{name} | {_clip(said, 300)} | {tail}")
            elif method == "tools/call":
                log("ok", "ANSWER", f"{name} | {tail}")
            elif method == "tools/list":
                log("list", "  tools", f"{len(res.get('tools') or [])} tools | {tail}")
            else:
                log("other", "  reply", f"{method or 'message'} | {tail}")


@mcp.custom_route("/health", methods=["GET"])
async def health(request):
    up = {}
    for name, base in (("ml", ML), ("agent", AGENT)):
        try:
            await call(base, "/health", quiet=True)
            up[name] = True
        except ToolError:
            up[name] = False
    return JSONResponse({"ok": all(up.values()), **up, "endpoint": "/mcp"})


# Plain JSON replies and no session state, so the endpoint works behind tunnels and proxies that buffer event streams
# (Cloudflare quick tunnels do). Host-header checking is off because a tunnel's public hostname is not known in
# advance; every tool is read-only and the data is public.
app = LogTraffic(mcp.streamable_http_app(json_response=True, stateless_http=True, host="0.0.0.0",
                                         transport_security=TransportSecuritySettings(enable_dns_rebinding_protection=False)))

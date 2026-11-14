# MCP server

Lets a chatbot (Claude, Cursor, or anything else that speaks the Model Context Protocol) use this project as a set of tools: read the unified test table, check what the data covers for an atmosphere, compare investigations and run the flame predictor. It is the same connection style as a GitHub or Figma connector.

## What was added

| Area | Change | Files |
| --- | --- | --- |
| MCP service | New container on port 8003. Endpoint `http://localhost:8003/mcp` (Streamable HTTP), plus `GET /health` | `services/mcp/app.py`, `services/mcp/Dockerfile`, `services/mcp/requirements.txt` |
| Compose | `mcp` service, started by `docker compose up`. Optional `tunnel` service behind a profile | `docker-compose.yml` |
| SQL endpoint | `POST /sql` on the `agent` service: the read-only SQL the Ask PSI agent already had, reachable without the language model | `services/agent/app.py` |
| SQL time limit | A query is stopped after 2 seconds, so an endless recursive query cannot hang the service | `services/agent/tools.py`, `services/agent/test_graph.py` |
| Test | A real MCP client calls every tool and compares the answers with the `ml` service | `services/mcp/test_mcp.py` |

## How it works

The MCP service holds no data and no model. Each tool forwards to an endpoint the web interface already uses, so a chatbot gets the same numbers as the dashboard.

| Tool | Does | Calls |
| --- | --- | --- |
| `list_investigations` | The 17 catalog entries with PSI ids and DOI links | `ml` `GET /catalog` |
| `search_tests` | Page through the unified table with filters, whole rows | `ml` `GET /tests` |
| `get_table_schema` | Columns, units and coded values of the SQL tables | `agent` `GET /schema` |
| `sql_query` | One read-only SELECT, at most 40 rows | `agent` `POST /sql` |
| `search_evidence` | Investigation descriptions, crew notes, NASA Technical Reports Server | `agent` `GET /search` |
| `list_environments` | Habitat presets (Earth, ISS, spacesuit, Moon base, rover, Mars habitat) | `ml` `GET /environments` |
| `check_environment_coverage` | Habitat Risk Navigator for one oxygen, pressure and gravity | `ml` `POST /navigator` |
| `compare_investigations` | Side-by-side comparison of two investigations | `ml` `GET /compare` |
| `predict_droplet_flame` | FLEX extinction and burning-rate models, with the burn they imply | `ml` `POST /predict` |
| `get_build_report` | Row counts by source and the models' cross-validated scores | `ml` `GET /report` |

Things worth knowing:

- Every tool is read-only and is marked so (`readOnlyHint`), which lets clients run it without asking each time.
- Three replies are trimmed, and only of data the web page draws: the navigator and compare replies drop the chart coordinates (`points`), and the predictor reply drops the per-frame animation arrays. No number is changed or added.
- When the predictor's inputs are outside what FLEX tested, the reply carries a `warning` sentence beside the service's own `extrapolating` and `outside` fields.
- The data rules from `CLAUDE.md` (planned rows have no result, 1-g thresholds are not flight tests, say when a value is `assumed`, cite PSI ids, nothing here is flight-safety guidance) are sent to the chatbot as the server's instructions and repeated in the tool descriptions. A chatbot can still ignore them: check what it says against the table.
- Ask PSI's chat (`POST /chat`) is not exposed. The connecting chatbot is already a language model; it gets Ask PSI's two tools directly, and no Groq key is spent.
- No sign-in. Anyone who can reach the port can call the tools. They only read public NASA data, but see the tunnel note below.
- Replies are plain JSON with no session state (`json_response`, `stateless_http`). No tool here needs streaming, and plain JSON passes through proxies and tunnels that hold back event streams (Cloudflare quick tunnels do).

## Connect a chatbot

Start the stack first: `docker compose up --build`.

**A client on the same computer** (Claude Code, Cursor, VS Code and others) can use the local address directly.

```bash
claude mcp add --transport http flame-in-freefall http://localhost:8003/mcp      # Claude Code
```

Most other desktop clients take the same address in their MCP settings file, commonly in this form (check the client's own documentation for the file and exact keys):

```json
{ "mcpServers": { "flame-in-freefall": { "url": "http://localhost:8003/mcp" } } }
```

**A hosted chatbot** (claude.ai and the Claude desktop and mobile apps; web chatbots in general) connects from the provider's servers, not from your computer, so `localhost` does not work. It needs a public `https` address. The `tunnel` service gives a temporary one:

```bash
docker compose --profile tunnel up --build
docker compose logs tunnel          # look for https://<random-words>.trycloudflare.com
```

Add that address followed by `/mcp` as a custom connector. In Claude: Customize, Connectors, add custom connector, paste the address. No OAuth settings are needed.

About the tunnel:

- The address is new on every start and stops working when the container stops.
- While it runs, anyone who has the address can call the tools. Stop it when the demo is over.
- For a lasting address, deploy the three services somewhere public or use a named Cloudflare tunnel with your own domain.

## How to check

```bash
docker compose up --build
curl http://localhost:8003/health                 # {"ok":true,"ml":true,"agent":true,"endpoint":"/mcp"}
pip install -r services/mcp/requirements.txt
cd services/mcp && python test_mcp.py             # ends with "all ok"
```

Without Docker, run the three services with the commands in `setup.md`, then the same test.

For a look by hand, the MCP Inspector lists the tools and lets you call them: `npx @modelcontextprotocol/inspector`, transport "Streamable HTTP", address `http://localhost:8003/mcp`.

## Checks that were run

Run on 15 November 2026 with Python 3.13 and the three services started directly with `uvicorn` (the commands the images use).

- `services/mcp/test_mcp.py` passes: 10 tools listed, all read-only. Catalog, table pages, navigator (all six presets), compare, predictor and report replies equal the `ml` service's own replies. SQL counts by kind equal `report.json` (780 flown, 160 planned, 52 thresholds). A write statement, an unknown column, an endless recursive query, an unknown investigation, an unknown fuel and out-of-range inputs each come back as a readable error.
- A client using the older handshake (protocol 2025-06-18: `initialize`, then `tools/call`) and one using the 2026-07-28 revision both work.
- A request carrying a foreign `Host` header, as a tunnel sends, is accepted.
- With the `ml` service stopped, a tool call returns "The ml service did not answer" and `/health` reports `"ml": false`.
- `services/agent/test_graph.py` still passes with the new time limit.

## Not checked

- The Docker image was not built and `docker compose up` was not run: no Docker daemon where this was written. The compose file was only parsed.
- The tunnel was not started, so no hosted chatbot has connected yet. The local Claude Code and Cursor settings above were not tried either. The checks used the MCP Python client and plain HTTP requests.
- `search_evidence` returned local results only: the NASA Technical Reports Server was not reachable from the test machine.
- How well a given chatbot follows the data rules.

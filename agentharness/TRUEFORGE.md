# TrueForge vertical slice

This slice demonstrates one complete, bounded agent workflow:

1. AlohaLive creates a persistent TrueForge session for a fictional visitor.
2. The agent calls the read-only `get_match_context` MCP tool.
3. The agent recomputes the documented score in a Daytona sandbox and compares it with the server-side oracle.
4. The agent proposes one match and calls `request_introduction`.
5. TrueForge pauses that call at a human approval checkpoint.
6. Allowing the exact pending call creates a short-lived, one-use capability bound to its normalized arguments; denial creates no capability.
7. The write tool consumes that capability and creates exactly one reversible, idempotent `demo_introduction_request_record`. A direct MCP client cannot create the effect.
8. A fresh SDK client lists the same session turns, proving reconnectable session persistence.

No path in this slice sends a message, makes a donation, deploys code, or performs a real-world introduction.

## Hermetic verification

The standard suite runs the real MCP HTTP handshake, validates the agent manifest, rejects a proposal that differs from the deterministic oracle, and proves that replaying the write tool creates only one record. It uses a temporary data directory and does not contact TrueForge or any model provider.

```bash
nvm use 22
npm ci
npm test
```

Node 22 or newer is required by `@truefoundry/trueforge-sdk`. The website deployment workflows use their own Node 20 runtime and do not install or execute the agent harness package.

## One-time live configuration

Keep all services local. Do not commit provider tokens or Daytona credentials.

1. Run TrueForge locally using `@truefoundry/trueforge` version `0.1.4`.
2. In TrueForge Settings, configure the model that will run the agent.
3. Configure the Daytona sandbox provider in TrueForge.
4. Register an MCP server named `alohalive-local` with URL `http://127.0.0.1:8787/mcp`.
5. Export the exact TrueForge model identifier and MCP server name in the shell that runs the live test:

```bash
export TRUEFORGE_MODEL='<provider/model-name>'
export TRUEFORGE_MCP_SERVER='alohalive-local'
export TRUEFORGE_BASE_URL='http://127.0.0.1:8790'
```

If the local TrueForge installation requires a token, export `TRUEFORGE_TOKEN` only in that shell. Never write it to this repository. The harness never logs the token or model/provider error text.

### Demo-only Bright Data loopback bridge

TrueForge 0.1.4 did not interoperate reliably with Bright Data's hosted remote transport in this demo. The built-in connector used bearer-header authentication and received `401`; connectors using Bright Data's documented tokenized remote URL could show Connected but timed out during a TrueForge turn. Do not reinterpret those failures as a live-data success.

The verified hackathon fallback is `demo/brightdata-mcp-bridge.mjs`. It invokes the pinned official `@brightdata/mcp@2.11.1` package over stdio and exposes only a loopback Streamable HTTP endpoint to TrueForge. The token enters the bridge only through its process environment, is removed from that environment after startup, remains in a closure, and is never returned or logged. There is no browser credential form.

Install the locked dependencies, enter the key without echoing it, and start the bridge:

```bash
npm ci
read -rs BRIGHTDATA_API_TOKEN
printf '\n'
BRIGHTDATA_API_TOKEN="$BRIGHTDATA_API_TOKEN" npm run demo:brightdata-bridge
unset BRIGHTDATA_API_TOKEN
```

The `unset` runs after the bridge exits. In TrueForge **Settings → Connectors**, add a no-auth MCP server named `brightdata-bridge` with URL `http://127.0.0.1:8788/mcp`, then export only its name:

```bash
export TRUEFORGE_BRIGHTDATA_MCP_SERVER='brightdata-bridge'
```

The bridge is intentionally non-production: it binds only `127.0.0.1`, accepts only loopback peers, permits one upstream call at a time, caps serialized results at 1 MB, discards raw upstream errors, and exposes exactly `search_engine` plus `scrape_as_markdown`. Scrape targets must be public HTTPS without URL credentials or private/reserved DNS results. SIGINT/SIGTERM and tests close the captured listener.

The optional live smoke is explicit and is never part of Node's automatic test discovery:

```bash
RUN_BRIGHTDATA_BRIDGE_SMOKE=1 npm run smoke:brightdata-bridge
```

`@brightdata/mcp@2.11.1` is pinned with lockfile integrity. Its unused nested `@modelcontextprotocol/sdk@1.21.2` triggers two high npm advisories; the shipped server resolves the harness's patched SDK 1.30.0 through FastMCP, and this fresh-per-call, loopback-only demo does not expose the vulnerable cross-client, DNS-rebinding, or ReDoS paths. No patched non-breaking Bright Data release is currently available, so this accepted hackathon limitation is another reason never to expose the bridge publicly.

See the official [Bright Data MCP package](https://www.npmjs.com/package/@brightdata/mcp), [Bright Data hosted MCP setup](https://docs.brightdata.com/ai/mcp-server/integrations/n8n), and [TrueForge MCP server setup](https://trueforge.dev/mcp-servers).

When configured, the agent may use only `search_engine` to find current Maui community needs and `scrape_as_markdown` to read one selected source. This is live, untrusted advisory web evidence with a source URL. It does not write to DynamoDB, alter deterministic oracle IDs or scores, execute an introduction, or feed the custom Bright Data-to-`CauseSignal` persistence pipeline in `src/ingest.js`.

The harness binds to `127.0.0.1` by default. The MCP endpoint independently requires both a loopback peer address and an allowed loopback Host header, so spoofing `Host: localhost` from a LAN client is insufficient. Run TrueForge as a host process for this local slice; do not expose the MCP endpoint to a container bridge, LAN, or public interface.

## Live evidence test

With TrueForge and its configured providers running, execute:

```bash
RUN_TRUEFORGE_LIVE=1 npm run test:live
```

The test uses fictional visitor identities and temporary local storage. It asserts:

- MCP initialization and a tool response are present in the streamed trace;
- a sandbox is created and persisted events contain the successful command/output plus an agreeing scorer receipt;
- `request_introduction` reaches `tool.approval_required` exactly once;
- a fresh SDK client restores the pending-approval event before the decision;
- a direct write-tool call without a matching approval capability is rejected;
- the denial path produces zero introduction records;
- the approval path consumes one capability and produces exactly one introduction record; and
- a fresh TrueForge SDK client can list the persisted session turns and the introduction receipt is read back from durable storage.

The live test deliberately fails fast when `RUN_TRUEFORGE_LIVE=1` is absent, so it cannot be mistaken for part of the credential-free default suite. It requires the persisted event history to contain an actual sandbox command, successful output, and a machine-readable score receipt whose sandbox and oracle values agree. It also reconnects before approval to restore the pending approval, reconnects after approval to list both turns, and reads the durable introduction receipt back from the JSON store.

`sandbox.created` does not identify the configured provider. TrueForge's local fallback can be used for a credential-free diagnostic, but that run is not qualifying Daytona evidence. Before labeling a trace as the Daytona acceptance run, verify separately that TrueForge reports the configured sandbox provider as Daytona; never print or commit the provider credential.

## API surface

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/agent/sessions` | Create the AlohaLive/TrueForge session mapping. |
| `GET` | `/api/agent/sessions/:sessionId` | Read local session, pending approval, trace summary, and effects. |
| `POST` | `/api/agent/sessions/:sessionId/turns` | Run the bounded match turn. |
| `GET` | `/api/agent/sessions/:sessionId/turns` | List persistent TrueForge turns with a fresh or existing client. |
| `POST` | `/api/agent/sessions/:sessionId/approvals` | Allow or deny the exact pending `request_introduction` call. |
| any | `/mcp` | Stateless MCP Streamable HTTP endpoint for the two domain tools. |

This demo API is intended for loopback development. It is not an authorization boundary for a public deployment.

# TrueForge vertical slice

This slice demonstrates one complete, bounded agent workflow:

1. AlohaLive creates a persistent TrueForge session for a fictional visitor.
2. The agent calls the read-only `get_match_context` MCP tool.
3. The agent recomputes the documented score in a Daytona sandbox and compares it with the server-side oracle.
4. The agent proposes one match and calls `request_introduction`.
5. TrueForge pauses that call at a human approval checkpoint.
6. Denial creates no record. Approval creates exactly one reversible, idempotent `demo_introduction_request_record`.
7. A fresh SDK client lists the same session turns, proving reconnectable session persistence.

No path in this slice sends a message, makes a donation, deploys code, or performs a real-world introduction.

## Hermetic verification

The standard suite runs the real MCP HTTP handshake, validates the agent manifest, rejects a proposal that differs from the deterministic oracle, and proves that replaying the write tool creates only one record. It uses a temporary data directory and does not contact TrueForge or any model provider.

```bash
npm ci
npm test
```

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

The MCP endpoint rejects non-loopback Host headers by default. If TrueForge itself runs in a local container, explicitly set `MCP_ALLOWED_HOSTS=host.docker.internal` and register `http://host.docker.internal:8787/mcp`; do not expose the endpoint to a LAN or public interface.

## Live evidence test

With TrueForge and its configured providers running, execute:

```bash
RUN_TRUEFORGE_LIVE=1 npm run test:live
```

The test uses fictional visitor identities and temporary local storage. It asserts:

- MCP initialization and a tool response are present in the streamed trace;
- a Daytona sandbox is created;
- `request_introduction` reaches `tool.approval_required` exactly once;
- the denial path produces zero introduction records;
- the approval path produces exactly one introduction record; and
- a fresh TrueForge SDK client can list the persisted session turns.

The live test deliberately fails fast when `RUN_TRUEFORGE_LIVE=1` is absent, so it cannot be mistaken for part of the credential-free default suite.

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

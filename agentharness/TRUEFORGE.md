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

The harness binds to `127.0.0.1` by default. The MCP endpoint independently requires both a loopback peer address and an allowed loopback Host header, so spoofing `Host: localhost` from a LAN client is insufficient. Run TrueForge as a host process for this local slice; do not expose the MCP endpoint to a container bridge, LAN, or public interface.

## Live evidence test

With TrueForge and its configured providers running, execute:

```bash
RUN_TRUEFORGE_LIVE=1 npm run test:live
```

The test uses fictional visitor identities and temporary local storage. It asserts:

- MCP initialization and a tool response are present in the streamed trace;
- a Daytona sandbox is created;
- `request_introduction` reaches `tool.approval_required` exactly once;
- a direct write-tool call without a matching approval capability is rejected;
- the denial path produces zero introduction records;
- the approval path consumes one capability and produces exactly one introduction record; and
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

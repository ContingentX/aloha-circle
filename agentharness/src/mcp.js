import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { getMatchContext, requestIntroduction } from './introductions.js';

const opaqueId = z.string().min(1).max(120).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/);

function jsonResult(value) {
  return {
    content: [{ type: 'text', text: JSON.stringify(value) }],
    structuredContent: value,
  };
}

function toolError(error) {
  return {
    isError: true,
    content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
  };
}

export function createAlohaMcpServer() {
  const server = new McpServer({ name: 'alohalive-domain-tools', version: '0.1.0' });

  server.registerTool(
    'get_match_context',
    {
      title: 'Get AlohaLive match context',
      description: 'Read the visitor, eligible Maui locals and causes, endorsements, scoring contract, and deterministic oracle.',
      inputSchema: {
        session_id: z.string().min(1),
        visitor_id: z.string().uuid(),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ session_id: sessionId, visitor_id: visitorId }) => {
      try {
        return jsonResult(getMatchContext({ sessionId, visitorId }));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    'request_introduction',
    {
      title: 'Request a demo introduction',
      description: 'Persist one reversible introduction-request record. TrueForge must obtain explicit human approval before calling this tool.',
      inputSchema: {
        session_id: z.string().min(1),
        visitor_id: z.string().uuid(),
        local_id: opaqueId,
        cause_id: opaqueId,
        explanation: z.string().min(1).max(1000),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({
      session_id: sessionId,
      visitor_id: visitorId,
      local_id: localId,
      cause_id: causeId,
      explanation,
    }) => {
      try {
        return jsonResult(requestIntroduction({ sessionId, visitorId, localId, causeId, explanation }));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  return server;
}

function allowedMcpHosts() {
  return new Set(
    (process.env.MCP_ALLOWED_HOSTS ?? '127.0.0.1,localhost,::1')
      .split(',')
      .map((host) => host.trim())
      .filter(Boolean),
  );
}

function requestHostname(req) {
  try {
    return new URL(`http://${req.headers.host}`).hostname.replace(/^\[|\]$/g, '');
  } catch {
    return '';
  }
}

export function isLoopbackAddress(address) {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

export async function handleMcpRequest(req, res) {
  if (!isLoopbackAddress(req.socket.remoteAddress) || !allowedMcpHosts().has(requestHostname(req))) {
    return res.status(403).json({ error: 'MCP host is not allowed' });
  }

  const server = createAlohaMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  res.on('close', () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}

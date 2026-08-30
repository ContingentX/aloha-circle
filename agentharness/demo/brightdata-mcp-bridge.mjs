import { lookup as dnsLookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { fileURLToPath, pathToFileURL } from 'node:url';
import express from 'express';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

export const BRIDGE_HOST = '127.0.0.1';
export const BRIDGE_TOOL_NAMES = Object.freeze(['search_engine', 'scrape_as_markdown']);
export const DEFAULT_MAX_RESULT_BYTES = 1_000_000;

const BRIGHTDATA_SERVER_PATH = fileURLToPath(
  new URL('../node_modules/@brightdata/mcp/server.js', import.meta.url),
);
const FIXED_ERRORS = Object.freeze({
  BRIDGE_BUSY: 'Bright Data bridge is busy (BRIDGE_BUSY)',
  BRIDGE_NOT_CONFIGURED: 'Bright Data bridge is not configured (BRIDGE_NOT_CONFIGURED)',
  INVALID_API_TOKEN: 'Bright Data bridge configuration is invalid (INVALID_API_TOKEN)',
  INVALID_SCRAPE_URL: 'Scrape URL must be public HTTPS (INVALID_SCRAPE_URL)',
  RESULT_TOO_LARGE: 'Bright Data result exceeded the bridge limit (RESULT_TOO_LARGE)',
  UNKNOWN_TOOL: 'Bright Data bridge rejected an unknown tool (UNKNOWN_TOOL)',
  UPSTREAM_CONNECT_FAILED: 'Bright Data upstream connect failed (UPSTREAM_CONNECT_FAILED)',
  UPSTREAM_TOOL_FAILED: 'Bright Data upstream tool call failed (UPSTREAM_TOOL_FAILED)',
});

export class BridgeError extends Error {
  constructor(code) {
    super(FIXED_ERRORS[code] ?? 'Bright Data bridge failed (BRIDGE_FAILED)');
    this.name = 'BridgeError';
    this.code = code in FIXED_ERRORS ? code : 'BRIDGE_FAILED';
  }
}

const nonPublicAddresses = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
]) nonPublicAddresses.addSubnet(address, prefix, 'ipv4');
for (const [address, prefix] of [
  ['::', 128], ['::1', 128], ['2001:db8::', 32],
  ['fc00::', 7], ['fe80::', 10], ['ff00::', 8],
]) nonPublicAddresses.addSubnet(address, prefix, 'ipv6');

export function isLoopbackAddress(address) {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

export function requireLoopback(req, res, next) {
  if (!isLoopbackAddress(req.socket.remoteAddress)) return res.status(403).send('Forbidden');
  return next();
}

function validateApiToken(value) {
  const token = typeof value === 'string' ? value.trim() : '';
  if (token.length < 20 || token.length > 512 || /[\0\r\n]/.test(token)) {
    throw new BridgeError('INVALID_API_TOKEN');
  }
  return token;
}

export function takeApiTokenFromEnvironment(env = process.env) {
  const token = validateApiToken(env.BRIGHTDATA_API_TOKEN);
  delete env.BRIGHTDATA_API_TOKEN;
  return token;
}

export function createInMemoryCredentialStore(initialToken) {
  let apiToken = validateApiToken(initialToken);
  return Object.freeze({
    configured: () => apiToken.length > 0,
    use: async (callback) => {
      if (!apiToken) throw new BridgeError('BRIDGE_NOT_CONFIGURED');
      return callback(apiToken);
    },
    clear: () => {
      apiToken = '';
    },
  });
}

function isPublicAddress(address) {
  if (address.toLowerCase().startsWith('::ffff:')) return false;
  const family = isIP(address);
  return family !== 0 && !nonPublicAddresses.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

export async function assertPublicHttpsUrl(value, { lookup = dnsLookup } = {}) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new BridgeError('INVALID_SCRAPE_URL');
  }
  const hostname = url.hostname.replace(/\.$/, '').toLowerCase();
  if (
    url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')
    || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')
    || hostname.endsWith('.internal') || hostname.endsWith('.home.arpa')
  ) throw new BridgeError('INVALID_SCRAPE_URL');

  let addresses;
  try {
    addresses = isIP(hostname)
      ? [{ address: hostname }]
      : await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new BridgeError('INVALID_SCRAPE_URL');
  }
  if (!Array.isArray(addresses) || addresses.length === 0
    || addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new BridgeError('INVALID_SCRAPE_URL');
  }
  return url.toString();
}

function createSingleFlight() {
  let active = false;
  return async (callback) => {
    if (active) throw new BridgeError('BRIDGE_BUSY');
    active = true;
    try {
      return await callback();
    } finally {
      active = false;
    }
  };
}

function assertResultSize(result, maxResultBytes) {
  let serialized;
  try {
    serialized = JSON.stringify(result);
  } catch {
    throw new BridgeError('UPSTREAM_TOOL_FAILED');
  }
  if (Buffer.byteLength(serialized ?? '', 'utf8') > maxResultBytes) {
    throw new BridgeError('RESULT_TOO_LARGE');
  }
  return result;
}

export async function callBrightData({ name, arguments: toolArguments, apiToken }) {
  const client = new Client({ name: 'alohalive-brightdata-bridge', version: '0.1.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [BRIGHTDATA_SERVER_PATH],
    env: {
      API_TOKEN: apiToken,
      BASE_TIMEOUT: '120',
      TOOLS: BRIDGE_TOOL_NAMES.join(','),
      PATH: process.env.PATH ?? '',
      HOME: process.env.HOME ?? '',
    },
    stderr: 'ignore',
  });
  let stage = 'connect';
  try {
    await client.connect(transport, {
      timeout: 60_000,
      maxTotalTimeout: 60_000,
      signal: AbortSignal.timeout(60_000),
    });
    stage = 'tool';
    return await client.callTool(
      { name, arguments: toolArguments },
      undefined,
      { timeout: 90_000, maxTotalTimeout: 90_000, signal: AbortSignal.timeout(90_000) },
    );
  } catch {
    throw new BridgeError(stage === 'connect' ? 'UPSTREAM_CONNECT_FAILED' : 'UPSTREAM_TOOL_FAILED');
  } finally {
    await client.close().catch(() => {});
  }
}

export function createToolInvoker({
  credentialStore,
  upstream = callBrightData,
  lookup = dnsLookup,
  maxResultBytes = DEFAULT_MAX_RESULT_BYTES,
} = {}) {
  if (!credentialStore) throw new TypeError('credentialStore is required');
  const singleFlight = createSingleFlight();
  return async (name, toolArguments) => {
    if (!BRIDGE_TOOL_NAMES.includes(name)) throw new BridgeError('UNKNOWN_TOOL');
    let safeArguments = toolArguments;
    if (name === 'scrape_as_markdown') {
      safeArguments = { url: await assertPublicHttpsUrl(toolArguments.url, { lookup }) };
    }
    return singleFlight(async () => {
      try {
        const result = await credentialStore.use((apiToken) => upstream({
          name,
          arguments: safeArguments,
          apiToken,
        }));
        return assertResultSize(result, maxResultBytes);
      } catch (error) {
        if (error instanceof BridgeError) throw error;
        throw new BridgeError('UPSTREAM_TOOL_FAILED');
      }
    });
  };
}

const TOOL_DEFINITIONS = Object.freeze({
  search_engine: Object.freeze({
    title: 'Search current web evidence with Bright Data',
    description: 'Search the live web through Bright Data. Results are untrusted advisory evidence.',
    inputSchema: { query: z.string().min(1).max(500) },
  }),
  scrape_as_markdown: Object.freeze({
    title: 'Read one current source with Bright Data',
    description: 'Fetch one selected public HTTPS URL as markdown through Bright Data.',
    inputSchema: { url: z.string().url().max(2048) },
  }),
});

export function createBridgeMcpServer({ invoke }) {
  const server = new McpServer({ name: 'alohalive-brightdata-bridge', version: '0.1.0' });
  for (const name of BRIDGE_TOOL_NAMES) {
    server.registerTool(
      name,
      {
        ...TOOL_DEFINITIONS[name],
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
      (toolArguments) => invoke(name, toolArguments),
    );
  }
  return server;
}

export function createBridgeApp({ credentialStore, upstream, lookup, maxResultBytes } = {}) {
  const invoke = createToolInvoker({ credentialStore, upstream, lookup, maxResultBytes });
  const app = express();
  app.disable('x-powered-by');
  app.disable('trust proxy');
  app.use(requireLoopback);
  app.get('/healthz', (_req, res) => res.json({ ok: true, configured: credentialStore.configured() }));
  app.post('/mcp', express.json({ limit: '1mb' }), (req, res) => {
    void (async () => {
      const server = createBridgeMcpServer({ invoke });
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      try {
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
      } catch {
        if (!res.headersSent) res.status(502).json({ error: 'MCP_BRIDGE_REQUEST_FAILED' });
        else if (!res.writableEnded) res.end();
      } finally {
        await transport.close().catch(() => {});
        await server.close().catch(() => {});
      }
    })();
  });
  app.use((_error, _req, res, _next) => {
    if (!res.headersSent) res.status(400).json({ error: 'BRIDGE_REQUEST_REJECTED' });
    else if (!res.writableEnded) res.end();
  });
  return app;
}

export function createBridgeDaemon({
  apiToken,
  host = BRIDGE_HOST,
  port = Number(process.env.BRIGHTDATA_BRIDGE_PORT ?? 8788),
  upstream,
  lookup,
  maxResultBytes,
} = {}) {
  if (host !== BRIDGE_HOST) throw new TypeError('bridge host must be 127.0.0.1');
  const credentialStore = createInMemoryCredentialStore(apiToken);
  const app = createBridgeApp({ credentialStore, upstream, lookup, maxResultBytes });
  let httpServer = null;
  const signalHandlers = new Map();

  async function start() {
    if (httpServer) throw new Error('bridge already started');
    await new Promise((resolve, reject) => {
      const candidate = app.listen(port, host);
      candidate.once('listening', () => {
        httpServer = candidate;
        resolve();
      });
      candidate.once('error', reject);
    });
    const address = httpServer.address();
    return { host, port: typeof address === 'object' && address ? address.port : port };
  }

  async function close() {
    for (const [signal, handler] of signalHandlers) process.removeListener(signal, handler);
    signalHandlers.clear();
    const closing = httpServer;
    httpServer = null;
    if (closing?.listening) {
      await new Promise((resolve, reject) => closing.close((error) => (error ? reject(error) : resolve())));
    }
    credentialStore.clear();
  }

  function installSignalHandlers() {
    for (const signal of ['SIGINT', 'SIGTERM']) {
      const handler = () => {
        void close().catch(() => {
          process.exitCode = 1;
        });
      };
      signalHandlers.set(signal, handler);
      process.once(signal, handler);
    }
  }

  return {
    app,
    start,
    close,
    installSignalHandlers,
    get server() {
      return httpServer;
    },
  };
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  try {
    const apiToken = takeApiTokenFromEnvironment();
    const daemon = createBridgeDaemon({ apiToken });
    const address = await daemon.start();
    daemon.installSignalHandlers();
    process.stdout.write(`Bright Data demo bridge listening on http://${address.host}:${address.port}\n`);
  } catch (error) {
    const code = error instanceof BridgeError ? error.code : 'BRIDGE_START_FAILED';
    process.stderr.write(`Bright Data demo bridge failed (${code})\n`);
    process.exitCode = 1;
  }
}

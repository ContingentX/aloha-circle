import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

if (process.env.RUN_BRIGHTDATA_BRIDGE_SMOKE !== '1') {
  throw new Error('RUN_BRIGHTDATA_BRIDGE_SMOKE=1 is required for the opt-in live smoke test');
}

const timeoutMs = 45_000;
const client = new Client({ name: 'alohalive-bridge-smoke', version: '0.1.0' });
const transport = new StreamableHTTPClientTransport(
  new URL(process.env.BRIGHTDATA_BRIDGE_URL ?? 'http://127.0.0.1:8788/mcp'),
);

try {
  await client.connect(transport, { signal: AbortSignal.timeout(5_000) });
  const listed = await client.listTools(undefined, { signal: AbortSignal.timeout(5_000) });
  const names = listed.tools.map(({ name }) => name).sort();
  const expected = ['scrape_as_markdown', 'search_engine'];
  if (JSON.stringify(names) !== JSON.stringify(expected)) throw new Error('unexpected tool allowlist');
  const toolName = process.env.BRIGHTDATA_SMOKE_TOOL ?? 'scrape_as_markdown';
  if (!expected.includes(toolName)) throw new Error('unsupported smoke tool');
  const toolArguments = toolName === 'search_engine'
    ? { query: 'current Maui community needs nonprofit volunteer help' }
    : { url: process.env.BRIGHTDATA_SMOKE_URL ?? 'https://www.mauicounty.gov/' };
  const result = await client.callTool(
    { name: toolName, arguments: toolArguments },
    undefined,
    { timeout: timeoutMs, maxTotalTimeout: timeoutMs, signal: AbortSignal.timeout(timeoutMs) },
  );
  const contentBytes = Buffer.byteLength(JSON.stringify(result.content ?? []), 'utf8');
  process.stdout.write(JSON.stringify({
    connected: true,
    tools: names,
    toolName,
    toolIsError: result.isError === true,
    contentBytes,
  }) + '\n');
  if (result.isError === true || contentBytes < 50) process.exitCode = 1;
} catch {
  process.stderr.write('Bright Data bridge smoke failed (SMOKE_FAILED)\n');
  process.exitCode = 1;
} finally {
  await client.close().catch(() => {});
}

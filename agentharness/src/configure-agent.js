import { DEFAULT_AGENT_NAME, buildAgentSpec, createTrueForgeClient, registerAlohaAgent } from './trueforge.js';

const name = process.env.TRUEFORGE_AGENT_NAME ?? DEFAULT_AGENT_NAME;
const result = await registerAlohaAgent({
  client: createTrueForgeClient(),
  agentName: name,
  agentSpec: buildAgentSpec(),
});

console.log(JSON.stringify({
  ok: true,
  action: result.action,
  agent: {
    id: result.agent.id,
    name: result.agent.name,
    model: result.agent.manifest.model.name,
    mcpServers: result.agent.manifest.mcp_servers?.map((server) => server.name) ?? [],
    approvalTools: result.agent.manifest.mcp_servers
      ?.flatMap((server) => server.require_approval_for_tools ?? []) ?? [],
    sandbox: result.agent.manifest.config?.sandbox?.enabled === true,
  },
}, null, 2));

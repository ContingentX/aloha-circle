import crypto from 'node:crypto';
import { TrueForge, isEventDelta, mergeEventDelta } from '@truefoundry/trueforge-sdk';
import { findById, insert, load, updateById } from './store.js';

function requiredConfig(value, name) {
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function createTrueForgeClient({
  baseUrl = process.env.TRUEFORGE_BASE_URL ?? 'http://127.0.0.1:8790',
  token = process.env.TRUEFORGE_TOKEN,
} = {}) {
  return new TrueForge({ baseUrl, token, timeoutInSeconds: 600 });
}

export function buildAgentSpec({
  modelName = process.env.TRUEFORGE_MODEL,
  mcpServerName = process.env.TRUEFORGE_MCP_SERVER,
} = {}) {
  return {
    model: {
      name: requiredConfig(modelName, 'TRUEFORGE_MODEL'),
      params: { max_tokens: 4096, temperature: 0.1, parallel_tool_calls: false },
    },
    instructions: [
      'You are the AlohaLive match-to-introduction agent.',
      'Always call get_match_context before proposing a match.',
      'Use the TrueForge sandbox to run a small deterministic program that applies the returned scoring contract.',
      'Compare the sandbox result with the returned oracle and stop if they differ.',
      'Explain the selected local, cause, evidence source, score, and proposed effect.',
      'Call request_introduction exactly once with the IDs supplied by the tool.',
      'That call must remain behind TrueForge human approval. If denied, stop and do not retry or substitute another write.',
      'Never send a message, donation, deployment, or real-world introduction.',
    ].join(' '),
    mcp_servers: [
      {
        name: requiredConfig(mcpServerName, 'TRUEFORGE_MCP_SERVER'),
        enable_tools: ['get_match_context', 'request_introduction'],
        preload_tools: ['get_match_context', 'request_introduction'],
        require_approval_for_tools: ['request_introduction'],
        preload: true,
      },
    ],
    config: {
      sandbox: { enabled: true, file_downloads: false },
      generative_ui: { enabled: false },
      ask_user_questions: { enabled: false },
      dynamic_sub_agents: { enabled: false },
      context_management: {
        compaction: { enabled: false },
        large_tool_response: { enabled: true },
      },
      iteration_limit: 20,
    },
  };
}

function parseArguments(value) {
  try {
    return JSON.parse(value || '{}');
  } catch {
    return {};
  }
}

async function collectTurn(stream) {
  const events = new Map();
  const trace = [];
  const approvalEvents = [];
  let turnId = null;
  let lastSequenceNumber = 0;
  let terminalState = null;

  for await (const { data: event, id } of stream.withMetadata()) {
    if (id != null) lastSequenceNumber = Number(id);
    if (event.type === 'turn.created') turnId = event.turnId;
    if (isEventDelta(event)) {
      const base = events.get(event.id);
      if (base) mergeEventDelta(base, event);
    } else {
      events.set(event.id, event);
    }
    if (event.type === 'tool.approval_required') approvalEvents.push(event);
    if (event.type === 'turn.done') terminalState = event.state;
    trace.push({ sequenceNumber: id == null ? null : Number(id), type: event.type, threadId: event.threadId ?? null });
  }

  const pendingApprovals = [];
  for (const pending of approvalEvents) {
    for (const ref of pending.toolCalls ?? []) {
      const message = events.get(ref.sourceEventId);
      const call = message?.type === 'model.message' ? message.toolCalls?.find((item) => item.id === ref.id) : null;
      if (!call) continue;
      const args = parseArguments(call.function.arguments);
      pendingApprovals.push({
        threadId: pending.threadId,
        toolCallId: ref.id,
        sourceEventId: ref.sourceEventId,
        toolName: call.toolInfo.name,
        arguments: args,
        argumentsHash: crypto.createHash('sha256').update(JSON.stringify(args)).digest('hex'),
      });
    }
  }

  return { turnId, lastSequenceNumber, terminalState, pendingApprovals, trace };
}

function getAlohaSession(sessionId) {
  const session = findById('sessions', sessionId);
  if (!session) throw new Error('unknown AlohaLive session');
  return session;
}

export async function createAlohaSession({ visitorId, client = createTrueForgeClient(), agentSpec } = {}) {
  const visitor = findById('visitors', visitorId);
  if (!visitor) throw new Error('unknown visitor');

  // Awaiting the Fern SDK response unwraps it to the parsed session object.
  const trueforgeSession = await client.sessions.create({
    agent: { spec: agentSpec ?? buildAgentSpec() },
  });
  return insert('sessions', {
    visitorId,
    trueforgeSessionId: trueforgeSession.id,
    status: 'ready',
    pendingApprovals: [],
  });
}

export async function runMatchTurn({ sessionId, client = createTrueForgeClient() } = {}) {
  const session = getAlohaSession(sessionId);
  const prompt = [
    `Match visitor ${session.visitorId} in TrueForge session ${session.trueforgeSessionId}.`,
    'Fetch the domain context through MCP, recompute the score in the sandbox, compare with the oracle,',
    'then propose and request exactly one demo introduction record.',
  ].join(' ');
  const stream = await client.sessions.createTurnStream(session.trueforgeSessionId, {
    input: [{ type: 'user.message', content: prompt }],
  });
  const result = await collectTurn(stream);
  updateById('sessions', session.id, {
    status: result.terminalState?.status ?? 'unknown',
    lastTurnId: result.turnId,
    lastSequenceNumber: result.lastSequenceNumber,
    pendingApprovals: result.pendingApprovals,
    lastTrace: result.trace,
  });
  return result;
}

export async function respondToApproval({
  sessionId,
  toolCallId,
  decision,
  reason,
  client = createTrueForgeClient(),
} = {}) {
  if (!['allow', 'deny'].includes(decision)) throw new Error('decision must be allow or deny');
  const session = getAlohaSession(sessionId);
  const pending = session.pendingApprovals?.find((item) => item.toolCallId === toolCallId);
  if (!pending || pending.toolName !== 'request_introduction') throw new Error('approval is not pending for this session');

  const approval = { status: decision };
  if (decision === 'deny') approval.reason = reason || 'denied by user';
  const stream = await client.sessions.createTurnStream(session.trueforgeSessionId, {
    input: [
      {
        type: 'user.tool_approval',
        threadId: pending.threadId,
        toolCallId: pending.toolCallId,
        approval,
      },
    ],
  });
  const result = await collectTurn(stream);
  updateById('sessions', session.id, {
    status: result.terminalState?.status ?? 'unknown',
    lastTurnId: result.turnId,
    lastSequenceNumber: result.lastSequenceNumber,
    pendingApprovals: result.pendingApprovals,
    lastTrace: result.trace,
    lastApproval: {
      decision,
      toolCallId,
      argumentsHash: pending.argumentsHash,
      decidedAt: new Date().toISOString(),
    },
  });
  return result;
}

export async function listTrueForgeTurns({ sessionId, client = createTrueForgeClient() } = {}) {
  const session = getAlohaSession(sessionId);
  const turns = [];
  for await (const turn of await client.sessions.listTurns(session.trueforgeSessionId)) {
    turns.push({ id: turn.id, state: turn.state, input: turn.input });
  }
  return turns;
}

export function getAlohaSessionState(sessionId) {
  const session = getAlohaSession(sessionId);
  return {
    session,
    introductions: load('introductions').filter((item) => item.trueforgeSessionId === session.trueforgeSessionId),
  };
}

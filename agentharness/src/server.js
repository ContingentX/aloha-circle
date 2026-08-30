import express from 'express';
import cors from 'cors';
import { findById, load, insert, counts, updateById } from './store.js';
import { rankMatch } from './matcher.js';
import { ingestOnce } from './ingest.js';
import { handleMcpRequest, isLoopbackAddress } from './mcp.js';
import { createPublicApiClient } from './public-api-client.js';
import {
  DEFAULT_AGENT_NAME,
  createAlohaSession,
  getAlohaSessionState,
  listTrueForgeTurns,
  registerAlohaAgent,
  respondToApproval,
  runMatchTurn,
} from './trueforge.js';

function asyncRoute(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

export function requireLoopback(req, res, next) {
  if (!isLoopbackAddress(req.socket?.remoteAddress)) {
    return res.status(403).json({ error: 'agent API is loopback-only' });
  }
  return next();
}

function trustedAgentOrigins() {
  return new Set(
    (process.env.AGENT_ALLOWED_ORIGINS ?? [
      'http://127.0.0.1:5173',
      'http://localhost:5173',
      'http://127.0.0.1:4174',
      'http://localhost:4174',
      'http://127.0.0.1:4175',
      'http://localhost:4175',
    ].join(','))
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  );
}

export function requireTrustedAgentOrigin(req, res, next) {
  const origin = req.get?.('origin');
  if (origin && !trustedAgentOrigins().has(origin)) {
    return res.status(403).json({ error: 'agent browser origin is not allowed' });
  }
  return next();
}

function createVisitorAndMatch(body = {}) {
  const { name, interests } = body;
  if (!name || !Array.isArray(interests) || interests.length === 0) return null;
  const visitor = insert('visitors', {
    name,
    interests,
    availability: body.availability ?? null,
    groupType: body.groupType ?? null,
    desiredInvolvement: body.desiredInvolvement ?? null,
  });
  const ranked = rankMatch(visitor, {
    locals: load('locals'),
    causes: load('causes'),
    endorsements: load('endorsements'),
  });
  const match = ranked ? insert('matches', ranked) : null;
  return { visitor, match };
}

function persistRemoteRecord(collection, record) {
  if (!record) return null;
  return findById(collection, record.id) ?? insert(collection, record);
}

export async function createAgentVisitorAndMatch(body = {}, { publicApiClient } = {}) {
  const publicApiBase = process.env.ALOHALIVE_PUBLIC_API_BASE?.trim();
  if (!publicApiBase && !publicApiClient) {
    const result = createVisitorAndMatch(body);
    return result ? { ...result, dataSource: 'local-demo-store' } : null;
  }

  const client = publicApiClient ?? createPublicApiClient({ baseUrl: publicApiBase });
  const remote = await client.createVisitorAndMatch(body);
  return {
    visitor: persistRemoteRecord('visitors', remote.visitor),
    match: persistRemoteRecord('matches', remote.match),
    dataSource: 'dynamo-public-api',
  };
}

function operatorPage() {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>AlohaLive Agent Console</title><style>
body{font:15px system-ui;background:#071b26;color:#eaf9ff;margin:0;padding:24px}h1{margin-top:0;color:#69dcff}
.muted{color:#9db8c3}.session{background:#0d2a38;border:1px solid #245166;border-radius:14px;padding:16px;margin:14px 0}
.pill{display:inline-block;background:#16485d;border-radius:999px;padding:4px 9px;margin-right:6px}button{border:0;border-radius:8px;padding:8px 12px;margin:5px 5px 0 0;font-weight:700;cursor:pointer}.allow{background:#50d890}.deny{background:#ff8b8b}
pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#06151e;padding:12px;border-radius:9px;max-height:280px;overflow:auto}a{color:#69dcff}
</style></head><body><h1>AlohaLive · TrueForge operator view</h1>
<p class="muted">Loopback-only live view of AlohaLive sessions, TrueForge IDs, event traces, approvals, and persisted effects. Refreshes every two seconds.</p>
<div id="root">Loading…</div><script>
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function decide(sessionId,toolCallId,decision){await fetch('/api/agent/sessions/'+encodeURIComponent(sessionId)+'/approvals',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({toolCallId,decision,reason:decision==='deny'?'Denied in operator console':undefined})});await load();}
async function load(){const r=await fetch('/api/agent/sessions');const data=await r.json();document.getElementById('root').innerHTML=data.sessions.length?data.sessions.map(x=>{
const pending=x.session.pendingApprovals||[],trace=x.session.lastDemoTrace||x.session.lastTrace||[];return '<section class="session"><div><span class="pill">'+esc(x.session.status)+'</span><strong>'+esc(x.visitor?.name||x.session.visitorId)+'</strong></div>'+
'<p>Agent: <code>'+esc(x.session.trueforgeAgentName||'unknown')+'</code><br>TrueForge: <code>'+esc(x.session.trueforgeSessionId)+'</code><br>Local session: <code>'+esc(x.session.id)+'</code></p>'+
(x.match?'<p><strong>Match:</strong> '+esc(x.match.localName)+' → '+esc(x.match.cause)+' · score '+esc(x.match.score)+'</p>':'')+
pending.map(p=>'<div><strong>Approval required:</strong> '+esc(p.toolName)+'<br><button class="allow" data-action="allow" data-session="'+esc(x.session.id)+'" data-tool="'+esc(p.toolCallId)+'">Allow introduction</button><button class="deny" data-action="deny" data-session="'+esc(x.session.id)+'" data-tool="'+esc(p.toolCallId)+'">Deny</button></div>').join('')+
'<details open><summary>Demo tool trace ('+trace.length+')</summary><pre>'+esc(JSON.stringify(trace,null,2))+'</pre></details>'+
'<details><summary>Persisted effects ('+x.introductions.length+')</summary><pre>'+esc(JSON.stringify(x.introductions,null,2))+'</pre></details></section>';}).join(''):'<p>No sessions yet. Submit the AlohaLive visitor form.</p>'}
document.addEventListener('click',event=>{const button=event.target.closest('button[data-action]');if(button)decide(button.dataset.session,button.dataset.tool,button.dataset.action)});
load().catch(e=>document.getElementById('root').textContent=e.message);setInterval(()=>load().catch(()=>{}),2000);
</script></body></html>`;
}

export function createServer({
  createSession = createAlohaSession,
  runTurn = runMatchTurn,
  approveTurn = respondToApproval,
  registerAgent = registerAlohaAgent,
  createAgentMatch = createAgentVisitorAndMatch,
} = {}) {
  const app = express();
  let agentRegistration;
  const ensureAgentRegistered = () => {
    agentRegistration ??= registerAgent();
    return agentRegistration;
  };
  app.use(cors());
  app.use(express.json());

  app.all('/mcp', asyncRoute(handleMcpRequest));

  app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'aloha-agentharness', counts: counts() }));

  app.post('/api/visitors', (req, res) => {
    const result = createVisitorAndMatch(req.body);
    if (!result) {
      return res.status(400).json({ error: 'name and interests[] are required' });
    }
    res.status(201).json(result);
  });

  app.post('/api/locals', (req, res) => {
    const { name, interests, causes } = req.body ?? {};
    if (!name || !Array.isArray(interests)) {
      return res.status(400).json({ error: 'name and interests[] are required' });
    }
    res.status(201).json(insert('locals', { name, interests, causes: causes ?? [], town: req.body.town ?? null, verified: false }));
  });

  app.post('/api/nonprofits', (req, res) => {
    const { name, causeTags } = req.body ?? {};
    if (!name || !Array.isArray(causeTags)) {
      return res.status(400).json({ error: 'name and causeTags[] are required' });
    }
    res.status(201).json(insert('nonprofits', { name, causeTags, needs: req.body.needs ?? [], website: req.body.website ?? null }));
  });

  app.post('/api/endorsements', (req, res) => {
    const verdicts = ['helping_now', 'generally_helping', 'not_sure', 'causing_concern'];
    const { local, nonprofit, verdict } = req.body ?? {};
    if (!local || !nonprofit || !verdicts.includes(verdict)) {
      return res.status(400).json({ error: `local, nonprofit and verdict (${verdicts.join('|')}) are required` });
    }
    res.status(201).json(insert('endorsements', { local, nonprofit, verdict, note: req.body.note ?? null }));
  });

  app.get('/api/causes', (_req, res) => res.json(load('causes')));
  app.get('/api/nonprofits', (_req, res) => {
    const endorsements = load('endorsements');
    res.json(load('nonprofits').map((np) => ({
      ...np,
      endorsements: endorsements.filter((e) => e.nonprofit === np.name).length,
      helpingNow: endorsements.filter((e) => e.nonprofit === np.name && e.verdict === 'helping_now').length,
    })));
  });
  app.get('/api/matches', (_req, res) => res.json(load('matches')));
  app.post('/api/ingest', asyncRoute(async (_req, res) => res.json(await ingestOnce())));

  app.use('/api/agent', requireLoopback, requireTrustedAgentOrigin);

  app.get('/api/agent/config', (_req, res) => res.json({
    agentName: process.env.TRUEFORGE_AGENT_NAME ?? DEFAULT_AGENT_NAME,
    binding: 'named',
  }));

  // One local-demo transaction: visitor -> deterministic match -> persistent
  // TrueForge session -> streamed turn. The deterministic match remains the
  // product answer; agent research is advisory and the write pauses for approval.
  app.post('/api/agent/runs', asyncRoute(async (req, res) => {
    await ensureAgentRegistered();
    const created = await createAgentMatch(req.body);
    if (!created) return res.status(400).json({ error: 'name and interests[] are required' });
    if (!created.match) return res.status(422).json({ error: 'no deterministic match available', ...created });
    const session = await createSession({
      visitorId: created.visitor.id,
      contextSource: created.dataSource,
    });
    updateById('sessions', session.id, { status: 'running' });
    void runTurn({ sessionId: session.id }).catch(() => {
      updateById('sessions', session.id, {
        status: 'error',
        pendingApprovals: [],
        lastTrace: [],
      });
    });
    res.status(202).json({
      ...created,
      agent: {
        name: session.trueforgeAgentName,
        binding: 'named',
        sessionId: session.id,
        trueforgeSessionId: session.trueforgeSessionId,
        status: 'running',
        pendingApprovals: [],
        eventCount: 0,
        dataSource: created.dataSource,
      },
    });
  }));

  app.get('/api/agent/sessions', (_req, res) => {
    const visitors = load('visitors');
    const matches = load('matches');
    const introductions = load('introductions');
    const sessions = load('sessions').slice().reverse().map((session) => ({
      session,
      visitor: visitors.find((item) => item.id === session.visitorId) ?? null,
      match: matches.find((item) => item.visitorId === session.visitorId) ?? null,
      introductions: introductions.filter((item) => item.trueforgeSessionId === session.trueforgeSessionId),
    }));
    res.json({ sessions });
  });

  app.get('/agent-console', requireLoopback, requireTrustedAgentOrigin, (_req, res) => {
    res.set('cache-control', 'no-store');
    res.type('html').send(operatorPage());
  });

  app.post('/api/agent/sessions', asyncRoute(async (req, res) => {
    await ensureAgentRegistered();
    const { visitorId } = req.body ?? {};
    if (!visitorId) return res.status(400).json({ error: 'visitorId is required' });
    const session = await createSession({ visitorId });
    res.status(201).json({
      sessionId: session.id,
      visitorId: session.visitorId,
      agentName: session.trueforgeAgentName,
      binding: 'named',
      status: session.status,
    });
  }));

  app.get('/api/agent/sessions/:sessionId', (req, res) => {
    try {
      res.json(getAlohaSessionState(req.params.sessionId));
    } catch {
      res.status(404).json({ error: 'session not found' });
    }
  });

  app.post('/api/agent/sessions/:sessionId/turns', asyncRoute(async (req, res) => {
    const result = await runTurn({ sessionId: req.params.sessionId });
    res.status(201).json(result);
  }));

  app.get('/api/agent/sessions/:sessionId/turns', asyncRoute(async (req, res) => {
    res.json(await listTrueForgeTurns({ sessionId: req.params.sessionId }));
  }));

  app.post('/api/agent/sessions/:sessionId/approvals', asyncRoute(async (req, res) => {
    const { toolCallId, decision, reason } = req.body ?? {};
    if (!toolCallId || !decision) return res.status(400).json({ error: 'toolCallId and decision are required' });
    const result = await approveTurn({
      sessionId: req.params.sessionId,
      toolCallId,
      decision,
      reason,
    });
    res.status(201).json(result);
  }));

  app.use((error, _req, res, _next) => {
    // Provider errors can contain prompts or headers. Keep server logs free of
    // user/model content and return a stable public error instead.
    console.error('[agentharness] agent operation failed', {
      name: error instanceof Error ? error.name : 'UnknownError',
      code: error?.code ?? null,
    });
    res.status(502).json({ error: 'agent operation failed' });
  });

  return app;
}

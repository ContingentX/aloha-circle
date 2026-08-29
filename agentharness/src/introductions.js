import crypto from 'node:crypto';
import { findById, insert, load, updateById } from './store.js';
import { rankMatch } from './matcher.js';

function fail(message) {
  const error = new Error(message);
  error.code = 'INVALID_INTRODUCTION';
  throw error;
}

export function normalizeIntroductionArguments({
  sessionId,
  visitorId,
  localId,
  causeId,
  explanation,
}) {
  return { sessionId, visitorId, localId, causeId, explanation };
}

export function introductionArgumentsFromToolCall(args = {}) {
  return normalizeIntroductionArguments({
    sessionId: args.session_id,
    visitorId: args.visitor_id,
    localId: args.local_id,
    causeId: args.cause_id,
    explanation: args.explanation,
  });
}

export function introductionArgumentsHash(args) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(normalizeIntroductionArguments(args)))
    .digest('hex');
}

function consumeIntroductionApproval(args) {
  const session = load('sessions').find((item) => item.trueforgeSessionId === args.sessionId);
  const approval = session?.approvedIntroduction;
  if (!approval || approval.argumentsHash !== introductionArgumentsHash(args)) {
    fail('no matching human-approved introduction is pending');
  }
  if (Date.parse(approval.expiresAt) <= Date.now()) {
    updateById('sessions', session.id, { approvedIntroduction: null });
    fail('the human-approved introduction has expired');
  }
  updateById('sessions', session.id, { approvedIntroduction: null });
}

export function getMatchContext({ sessionId, visitorId }) {
  const session = load('sessions').find((item) => item.trueforgeSessionId === sessionId);
  if (!session) fail('unknown TrueForge session');
  if (session.visitorId !== visitorId) fail('visitor does not belong to this session');

  const visitor = findById('visitors', visitorId);
  if (!visitor) fail('unknown visitor');

  const locals = load('locals');
  const causes = load('causes');
  const endorsements = load('endorsements');
  const oracle = rankMatch(visitor, { locals, causes, endorsements });
  if (!oracle) fail('no eligible match');

  return {
    visitor,
    locals,
    causes,
    endorsements,
    scorer: {
      sharedInterestWeight: 3,
      localCauseWeight: 2,
      visitorCauseWeight: 2,
      urgencyWeight: 1,
      endorsementWeights: { helping_now: 2, generally_helping: 1, not_sure: 0, causing_concern: -3 },
      endorsementCap: 5,
    },
    oracle,
  };
}

export function requestIntroduction({ sessionId, visitorId, localId, causeId, explanation }) {
  const args = normalizeIntroductionArguments({ sessionId, visitorId, localId, causeId, explanation });
  const context = getMatchContext(args);
  if (context.oracle.localId !== localId || context.oracle.causeId !== causeId) {
    fail('proposal does not match the deterministic scoring oracle');
  }

  const idempotencyKey = crypto
    .createHash('sha256')
    .update([sessionId, visitorId, localId, causeId].join(':'))
    .digest('hex');
  const existing = load('introductions').find((item) => item.idempotencyKey === idempotencyKey);
  if (existing) return { introduction: existing, created: false };

  // TrueForge stages this one-use capability only after the human allows the
  // exact pending tool call. Direct MCP clients therefore cannot create the effect.
  consumeIntroductionApproval(args);

  const introduction = insert('introductions', {
    idempotencyKey,
    trueforgeSessionId: sessionId,
    visitorId,
    localId,
    causeId,
    explanation,
    status: 'pending',
    effect: 'demo_introduction_request_record',
  });
  return { introduction, created: true };
}

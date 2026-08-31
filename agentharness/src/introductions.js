import crypto from 'node:crypto';
import { findById, insert, load, updateById } from './store.js';
import { MATCH_SCORING_CONTRACT, rankMatch } from './matcher.js';

function fail(message) {
  const error = new Error(message);
  error.code = 'INVALID_INTRODUCTION';
  throw error;
}

function compactVisitor(visitor) {
  return { id: visitor.id, name: visitor.name, interests: visitor.interests };
}

function buildSandboxVerification(oracle) {
  const receipt = oracle.scoreReceipt;
  const endorsementSum = receipt.endorsementSum ?? receipt.endorsementRawScore;
  const expression = [
    `${MATCH_SCORING_CONTRACT.sharedInterestWeight}*${receipt.sharedInterestCount}`,
    `${MATCH_SCORING_CONTRACT.localCauseWeight}*${receipt.localCauseOverlapCount}`,
    `${MATCH_SCORING_CONTRACT.visitorCauseWeight}*${receipt.visitorCauseOverlapCount}`,
    `${MATCH_SCORING_CONTRACT.urgencyWeight}*${receipt.urgency}`,
    `(${endorsementSum}<${MATCH_SCORING_CONTRACT.endorsementCap}?${endorsementSum}:${MATCH_SCORING_CONTRACT.endorsementCap})`,
  ].join('+');
  const command = [
    `s=$((${expression}))`,
    `[ $s -eq ${oracle.score} ]&&a=true||a=false`,
    `printf 'ALOHALIVE_SCORE_RECEIPT={"sandboxScore":%d,"oracleScore":%d,"localId":"%s","causeId":"%s","agrees":%s}\\n' $s ${oracle.score} ${oracle.localId} ${oracle.causeId} $a`,
  ].join(';');
  return {
    tool: 'exec',
    arguments: {
      intent: 'Verify the deterministic AlohaLive score exactly once.',
      command,
    },
  };
}

function compactContext({ sessionId, visitor, oracle, authoritativeSource }) {
  if (!oracle.scoreReceipt || oracle.scoreReceipt.total !== oracle.score) {
    fail('match is missing its deterministic scoring receipt');
  }
  return {
    visitor: compactVisitor(visitor),
    scorer: MATCH_SCORING_CONTRACT,
    oracle,
    sandboxVerification: buildSandboxVerification(oracle),
    introductionProposal: {
      session_id: sessionId,
      visitor_id: visitor.id,
      local_id: oracle.localId,
      cause_id: oracle.causeId,
      explanation: oracle.why,
    },
    ...(authoritativeSource ? { authoritativeSource } : {}),
  };
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

  if (session.contextSource === 'dynamo-public-api') {
    const oracle = load('matches').find((item) => item.visitorId === visitorId);
    if (!oracle || oracle.scoreReceipt?.total !== oracle.score) {
      fail('Dynamo match is missing its deterministic scoring receipt');
    }
    const localBlock = oracle.blocks?.find((block) => block.type === 'local');
    const causeBlock = oracle.blocks?.find((block) => block.type === 'cause');
    return compactContext({
      sessionId,
      visitor,
      oracle,
      authoritativeSource: 'dynamo-public-api',
    });
  }

  const locals = load('locals');
  const causes = load('causes');
  const endorsements = load('endorsements');
  const oracle = rankMatch(visitor, { locals, causes, endorsements });
  if (!oracle) fail('no eligible match');

  return compactContext({ sessionId, visitor, oracle });
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

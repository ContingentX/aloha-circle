import express from 'express';
import cors from 'cors';
import { load, insert, counts } from './store.js';
import { matchVisitor } from './matcher.js';
import { ingestOnce } from './ingest.js';

export function createServer() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'aloha-agentharness', counts: counts() }));

  app.post('/api/visitors', (req, res) => {
    const { name, interests } = req.body ?? {};
    if (!name || !Array.isArray(interests) || interests.length === 0) {
      return res.status(400).json({ error: 'name and interests[] are required' });
    }
    const visitor = insert('visitors', {
      name,
      interests,
      availability: req.body.availability ?? null,
      groupType: req.body.groupType ?? null,
      desiredInvolvement: req.body.desiredInvolvement ?? null,
    });
    const match = matchVisitor(visitor);
    res.status(201).json({ visitor, match });
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
  app.post('/api/ingest', (_req, res) => res.json(ingestOnce()));

  return app;
}

import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { config } from '../config.js';
import { HttpError, placementAuth, requireDb } from '../middleware/security.js';
import { placementMeta, placementStats } from '../services/aggregate.js';
import { removeSamples, seedSamples } from '../services/sampleData.js';

const router = Router();
router.use(rateLimit({
  windowMs: 15 * 60 * 1000, limit: 120, standardHeaders: true, legacyHeaders: false,
  message: { error: { code: 'rate_limited', message: 'Too many requests. Please wait a few minutes.' } },
}));

// Verifies the passcode (or reports that none is required)
router.get('/meta', placementAuth, requireDb, async (_req, res, next) => {
  try {
    res.json({ passcodeRequired: !!config.placementPasscode, demoSeedAllowed: config.allowDemoSeed, ...(await placementMeta()) });
  } catch (err) { next(err); }
});

router.get('/stats', placementAuth, requireDb, async (req, res, next) => {
  try {
    const dataset = req.query.dataset === 'sample' ? 'sample' : 'real';
    const college = typeof req.query.college === 'string' ? req.query.college.slice(0, 80) : undefined;
    res.json(await placementStats({ college: college || undefined, dataset }));
  } catch (err) { next(err); }
});

router.post('/sample', placementAuth, requireDb, async (_req, res, next) => {
  try {
    if (!config.allowDemoSeed) throw new HttpError(403, 'demo_disabled', 'Sample data is disabled on this server (ALLOW_DEMO_SEED=false).');
    res.json({ created: await seedSamples() });
  } catch (err) { next(err); }
});

router.delete('/sample', placementAuth, requireDb, async (_req, res, next) => {
  try {
    if (!config.allowDemoSeed) throw new HttpError(403, 'demo_disabled', 'Sample data is disabled on this server (ALLOW_DEMO_SEED=false).');
    res.json({ removed: await removeSamples() });
  } catch (err) { next(err); }
});

export default router;

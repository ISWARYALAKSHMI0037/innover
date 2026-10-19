import { Router } from 'express';
import mongoose from 'mongoose';
import { config } from '../config.js';
import { llmStatus } from '../services/llm.js';

const router = Router();

router.get('/health', (_req, res) => {
  const llm = llmStatus();
  res.json({
    ok: true,
    db: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    llm: { provider: llm.provider, model: llm.model, configured: llm.configured },
    placementProtected: !!config.placementPasscode,
    limits: { maxUploadMB: Math.round(config.upload.maxBytes / 1048576), maxTextChars: config.upload.maxTextChars, minTextChars: config.upload.minTextChars },
    time: new Date().toISOString(),
  });
});

export default router;

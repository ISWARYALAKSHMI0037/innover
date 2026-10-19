import { Router } from 'express';
import mongoose from 'mongoose';
import rateLimit from 'express-rate-limit';
import { Analysis, toDetail, toSummary } from '../models/Analysis.js';
import { HttpError, requireClientId, requireDb } from '../middleware/security.js';
import { sniffFileType, uploadSingle } from '../middleware/upload.js';
import { INITIAL_PROGRESS, prepareInput, startPipeline } from '../services/pipeline.js';
import { studentStats } from '../services/aggregate.js';

const router = Router();
const analyzeLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'rate_limited', message: 'Too many analyses from this network. Please wait a few minutes and try again.' } },
});

const STALE_MS = 5 * 60 * 1000;

const cleanCollege = (v) => {
  if (typeof v !== 'string') return undefined;
  const c = v.replace(/[^\p{L}\p{N} .,&()'-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 80);
  return c || undefined;
};

router.post('/analyze', requireDb, requireClientId, analyzeLimiter, uploadSingle, async (req, res, next) => {
  try {
    const body = req.body || {};
    const text = typeof body.text === 'string' ? body.text : '';
    const file = req.file;
    if (file && text.trim()) throw new HttpError(400, 'both_inputs', 'Send either pasted text or a file, not both.');
    if (!file && !text.trim()) throw new HttpError(400, 'no_input', 'Paste the offer text or upload a PDF/image.');

    const language = body.language === 'ta' ? 'ta' : 'en';
    const shareWithCampus = body.shareWithCampus !== 'false';
    const college = cleanCollege(body.college);

    let sniffed = null;
    if (file) {
      sniffed = sniffFileType(file.buffer);
      if (!sniffed) throw new HttpError(415, 'unsupported_type', 'This file is not a valid PDF, PNG, JPG or WebP (its contents do not match its extension).');
    }
    const prepared = await prepareInput({ text, file, mimeType: sniffed });

    const doc = await Analysis.create({
      clientId: req.clientId,
      language,
      college,
      shareWithCampus,
      status: 'processing',
      progress: INITIAL_PROGRESS,
      source: {
        ...prepared.source,
        fileName: file ? (file.originalname || 'upload').replace(/[^\w.\- ()]/g, '_').slice(0, 120) : undefined,
        mimeType: sniffed || 'text/plain',
        sizeBytes: file ? file.size : Buffer.byteLength(text),
      },
    });

    startPipeline(doc._id, prepared, language);
    res.status(202).json({ id: String(doc._id) });
  } catch (err) {
    next(err);
  }
});

router.get('/analyses', requireDb, requireClientId, async (req, res, next) => {
  try {
    const filter = { clientId: req.clientId };
    if (['Low', 'Medium', 'High'].includes(req.query.risk)) filter.riskLevel = req.query.risk;
    if (typeof req.query.q === 'string' && req.query.q.trim()) {
      const q = req.query.q.trim().slice(0, 60).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = ['companyName', 'senderEmail', 'jobTitle'].map((f) => ({ [f]: { $regex: q, $options: 'i' } }));
    }
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(50, Math.max(1, parseInt(req.query.pageSize, 10) || 12));
    const [items, total] = await Promise.all([
      Analysis.find(filter).select('-rawText -extraction -verification -report').sort({ createdAt: -1 }).skip((page - 1) * pageSize).limit(pageSize),
      Analysis.countDocuments(filter),
    ]);
    res.json({ items: items.map(toSummary), total, page, pageSize });
  } catch (err) {
    next(err);
  }
});

router.get('/stats/me', requireDb, requireClientId, async (req, res, next) => {
  try {
    res.json(await studentStats(req.clientId));
  } catch (err) {
    next(err);
  }
});

async function loadOwned(req) {
  if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(404, 'not_found', 'No such analysis.');
  const doc = await Analysis.findOne({ _id: req.params.id, clientId: req.clientId });
  if (!doc) throw new HttpError(404, 'not_found', 'No such analysis. It may have been deleted, or it belongs to a different browser.');
  return doc;
}

router.get('/analyses/:id', requireDb, requireClientId, async (req, res, next) => {
  try {
    const doc = await loadOwned(req);
    if (doc.status === 'processing' && Date.now() - doc.updatedAt.getTime() > STALE_MS) {
      doc.status = 'failed';
      doc.errorCode = 'stalled';
      doc.errorMessage = 'The analysis stopped before finishing (the server may have restarted). Please run it again.';
      await doc.save();
    }
    res.json(toDetail(doc));
  } catch (err) {
    next(err);
  }
});

router.delete('/analyses/:id', requireDb, requireClientId, async (req, res, next) => {
  try {
    const doc = await loadOwned(req);
    await doc.deleteOne();
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;

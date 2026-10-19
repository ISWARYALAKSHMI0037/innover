import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import mongoose from 'mongoose';
import { config } from './config.js';
import { errorHandler, notFound } from './middleware/security.js';
import healthRoutes from './routes/health.js';
import analysisRoutes from './routes/analyses.js';
import placementRoutes from './routes/placement.js';
import { llmStatus } from './services/llm.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

if (config.trustProxy) app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet());
app.use(cors({
  origin(origin, cb) {
    if (!origin || config.clientOrigins.includes(origin)) return cb(null, true);
    cb(null, false);
  },
  allowedHeaders: ['Content-Type', 'X-Client-Id', 'X-Placement-Passcode'],
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  maxAge: 600,
}));
app.use(express.json({ limit: '100kb' }));

app.use('/api', rateLimit({
  windowMs: 60 * 1000, limit: 240, standardHeaders: true, legacyHeaders: false,
  message: { error: { code: 'rate_limited', message: 'Too many requests. Please slow down.' } },
}));
app.use('/api', healthRoutes);
app.use('/api', analysisRoutes);
app.use('/api/placement', placementRoutes);
app.use('/api', notFound);

// Optionally serve the built React app (single-service deployment)
const dist = path.resolve(__dirname, '../../client/dist');
if ((config.serveClient || config.env === 'production') && fs.existsSync(path.join(dist, 'index.html'))) {
  app.use(express.static(dist, { maxAge: '1h', index: false }));
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  console.log(`[web] serving client from ${dist}`);
}

app.use(errorHandler);

// ───── MongoDB: connect in the background and keep retrying, so the API can report "db unavailable" clearly ─────
mongoose.set('strictQuery', true);
let retryTimer;
async function connectDb() {
  try {
    await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 5000 });
    console.log('[db] connected');
  } catch (err) {
    console.error(`[db] connection failed: ${err.message}. Retrying in 5s…`);
    retryTimer = setTimeout(connectDb, 5000);
  }
}
mongoose.connection.on('disconnected', () => console.warn('[db] disconnected'));

const server = app.listen(config.port, () => {
  const llm = llmStatus();
  console.log(`[api] OfferCheck API listening on http://localhost:${config.port}`);
  if (!llm.configured) console.warn(`[llm] No API key for provider "${llm.provider}". Analyses will fall back to basic extraction (text only) and rule-based reports.`);
  else console.log(`[llm] ${llm.provider} / ${llm.model}`);
  if (!config.placementPasscode) console.warn('[security] PLACEMENT_CELL_PASSCODE is empty — the placement dashboard is open to anyone who can reach this server.');
});
connectDb();

const shutdown = async () => {
  clearTimeout(retryTimer);
  server.close();
  await mongoose.disconnect().catch(() => {});
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

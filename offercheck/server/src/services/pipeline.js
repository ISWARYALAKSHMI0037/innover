import sharp from 'sharp';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import { config } from '../config.js';
import { Analysis } from '../models/Analysis.js';
import { HttpError } from '../middleware/security.js';
import { supportsPdfNatively, LlmError } from './llm.js';
import { extractOffer, normalizeExtraction, backfillFromText } from './extraction.js';
import { runVerification } from './verification/index.js';
import { generateReport } from './report.js';
import { extractWebHosts } from '../utils/domain.js';
import { SIGNAL_LABELS } from './signalLabels.js';

export const INITIAL_PROGRESS = [
  { key: 'extract', label: 'Reading the offer', status: 'pending' },
  { key: 'verify', label: 'Running live checks (RDAP + DNS + text analysis)', status: 'pending' },
  { key: 'report', label: 'Writing the evidence-based report', status: 'pending' },
];

/**
 * Validate and pre-process the submission *synchronously*, so bad input is rejected with a clear 4xx
 * before any background work starts.
 */
export async function prepareInput({ text, file, mimeType }) {
  if (!file) {
    const t = (text || '').replace(/\r\n/g, '\n').trim();
    if (t.length < config.upload.minTextChars) throw new HttpError(400, 'text_too_short', `Paste at least ${config.upload.minTextChars} characters of the offer.`);
    if (t.length > config.upload.maxTextChars) throw new HttpError(400, 'text_too_long', `Text is too long (limit ${config.upload.maxTextChars.toLocaleString()} characters).`);
    return { kind: 'text', text: t, source: { type: 'text', textLength: t.length } };
  }

  if (mimeType === 'application/pdf') {
    let parsed;
    try {
      parsed = await pdfParse(file.buffer, { max: 15 });
    } catch {
      throw new HttpError(422, 'bad_pdf', 'This PDF could not be read. It may be corrupted or password-protected.');
    }
    const t = (parsed.text || '').replace(/\r\n/g, '\n').trim();
    if (t.replace(/\s/g, '').length >= 80) {
      return { kind: 'pdf-text', text: t.slice(0, config.upload.maxTextChars), source: { type: 'pdf', textLength: Math.min(t.length, config.upload.maxTextChars), textOrigin: 'provided' } };
    }
    if (!supportsPdfNatively()) {
      throw new HttpError(422, 'scanned_pdf_unsupported', 'This PDF has no selectable text (it looks scanned) and the configured AI provider cannot read PDFs directly. Upload a screenshot or photo (PNG/JPG) of the offer instead.');
    }
    return { kind: 'pdf-scan', pdf: { data: file.buffer.toString('base64') }, source: { type: 'pdf', textOrigin: 'llm-transcription' } };
  }

  // Image: validate with sharp, orient, shrink and re-encode (also strips metadata)
  try {
    const opts = { limitInputPixels: 50_000_000, failOn: 'error' };
    const meta = await sharp(file.buffer, opts).metadata();
    if ((meta.width || 0) < 200 || (meta.height || 0) < 200) throw new HttpError(422, 'image_too_small', 'This image is too small to read reliably (minimum 200×200 pixels).');
    const processed = await sharp(file.buffer, opts)
      .rotate()
      .resize({ width: 1800, height: 1800, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .normalize()
      .jpeg({ quality: 85 })
      .toBuffer();
    return { kind: 'image', image: { mediaType: 'image/jpeg', data: processed.toString('base64') }, source: { type: 'image', textOrigin: 'llm-transcription' } };
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(422, 'bad_image', 'This image could not be processed. Try a different PNG, JPG or WebP file.');
  }
}

/** Last-resort extraction when the AI is unavailable: only what regexes can find. */
function deterministicExtraction(text) {
  const ex = normalizeExtraction({});
  backfillFromText(ex, text);
  ex.websiteDomains = extractWebHosts(text).slice(0, 8);
  return ex;
}

function buildStats(verification) {
  const flagged = verification.checks.filter((c) => c.counted);
  const keys = [...new Set(flagged.map((c) => c.dedupeKey || c.id))].filter((k) => SIGNAL_LABELS[k]);
  const sender = verification.domains.find((d) => d.roles.includes('sender'));
  const free = verification.checks.some((c) => ['sender-free', 'sender-disposable'].includes(c.id));
  return {
    signalIds: keys,
    signalTitles: keys.map((k) => SIGNAL_LABELS[k]),
    paymentRequested: verification.checks.some((c) => ['payment-request', 'payment-method'].includes(c.id)),
    paymentCategories: verification.paymentCategories || [],
    freeEmail: free,
    senderDomain: sender?.domain,
    senderDomainAgeDays: sender?.rdap?.status === 'ok' ? sender.rdap.ageDays : undefined,
    confidence: verification.confidence,
  };
}

const friendly = (err) => {
  if (err instanceof LlmError) return { code: `llm_${err.code}`, message: err.message };
  return { code: 'pipeline_error', message: 'The analysis failed unexpectedly. Please try again.' };
};

export function startPipeline(id, prepared, language) {
  runPipeline(id, prepared, language).catch((err) => console.error('[pipeline] unhandled', err));
}

async function runPipeline(id, prepared, language) {
  const step = (i, status, note) =>
    Analysis.updateOne({ _id: id }, { $set: { [`progress.${i}.status`]: status, ...(note !== undefined ? { [`progress.${i}.note`]: note } : {}) } });

  let extraction, sourceText, model, dropped = [], textOrigin;

  // ── 1. Extraction ──
  try {
    await step(0, 'running');
    const r = await extractOffer({ text: prepared.text, image: prepared.image, pdf: prepared.pdf });
    ({ extraction, sourceText, model, droppedUngrounded: dropped, textOrigin } = r);
    await step(0, 'done', `Extracted with ${model}${dropped.length ? ` · ${dropped.length} unverifiable item${dropped.length > 1 ? 's' : ''} discarded` : ''}`);
  } catch (err) {
    const canDegrade = prepared.text && err instanceof LlmError;
    if (!canDegrade) {
      const f = friendly(err);
      await step(0, 'failed', f.message);
      await Analysis.updateOne({ _id: id }, { $set: { status: 'failed', errorCode: f.code, errorMessage: f.message } });
      return;
    }
    extraction = deterministicExtraction(prepared.text);
    sourceText = prepared.text;
    textOrigin = 'provided';
    await step(0, 'skipped', `AI extraction unavailable (${err.message}) — used basic pattern extraction. Company name is unknown, so name-vs-domain checks are limited.`);
  }

  // ── 2. Verification (real lookups) ──
  let verification;
  try {
    await step(1, 'running');
    verification = await runVerification(extraction, sourceText);
    const s = verification.lookupSummary;
    await step(1, 'done', s.domainsChecked
      ? `${s.domainsChecked} domain${s.domainsChecked > 1 ? 's' : ''} · RDAP answered ${s.rdapOk}/${s.domainsChecked} · DNS answered ${s.dnsOk}/${s.domainsChecked}`
      : 'No domains to look up · text checks only');
  } catch (err) {
    console.error('[pipeline] verification failed', err);
    await step(1, 'failed', 'The verification engine crashed.');
    await Analysis.updateOne({ _id: id }, { $set: { status: 'failed', errorCode: 'verification_error', errorMessage: 'The verification engine hit an unexpected error. Please try again.' } });
    return;
  }

  // ── 3. Report ──
  await step(2, 'running');
  const report = await generateReport(extraction, verification, language);
  if (report.generatedBy === 'ai') await step(2, 'done', `Explained from the evidence by ${report.model}${report.groundingRemoved ? ` · ${report.groundingRemoved} unsupported statement(s) removed` : ''}`);
  else await step(2, 'skipped', `AI explanation unavailable (${report.llmError || 'unknown reason'}) — showing the rule-based summary.`);

  const rawText = prepared.kind === 'text' || prepared.kind === 'pdf-text' ? prepared.text : sourceText;
  const set = {
    status: 'complete',
    extraction,
    droppedUngrounded: dropped,
    verification,
    report,
    rawText: (rawText || '').slice(0, 30000),
    riskLevel: report.riskLevel,
    riskScore: verification.score,
    companyName: extraction.companyName,
    jobTitle: extraction.jobTitle,
    senderEmail: extraction.senderEmail,
    stats: buildStats(verification),
  };
  if (textOrigin) set['source.textOrigin'] = textOrigin;
  if (model) set['source.model'] = model;
  await Analysis.updateOne({ _id: id }, { $set: set });
}

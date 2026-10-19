import { Analysis } from '../models/Analysis.js';
import { SIGNAL_LABELS } from './signalLabels.js';

const DAY = 86_400_000;

function weekStart(d) {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = (x.getUTCDay() + 6) % 7; // Monday = 0
  return new Date(x.getTime() - dow * DAY);
}

const ageBucket = (days) =>
  days == null ? 'Unknown' : days < 30 ? 'Under 30 days' : days < 180 ? '30–180 days' : days < 365 ? '6–12 months' : days < 1095 ? '1–3 years' : 'Over 3 years';
const BUCKET_ORDER = ['Under 30 days', '30–180 days', '6–12 months', '1–3 years', 'Over 3 years', 'Unknown'];

export async function studentStats(clientId) {
  const rows = await Analysis.aggregate([
    { $match: { clientId, status: 'complete' } },
    { $group: { _id: '$riskLevel', n: { $sum: 1 } } },
  ]);
  const by = Object.fromEntries(rows.map((r) => [r._id, r.n]));
  const failed = await Analysis.countDocuments({ clientId, status: 'failed' });
  return { total: (by.Low || 0) + (by.Medium || 0) + (by.High || 0), low: by.Low || 0, medium: by.Medium || 0, high: by.High || 0, failed };
}

/**
 * Aggregate, non-identifying campus statistics.
 * dataset = 'real' (default) or 'sample' (clearly separate; never mixed).
 */
export async function placementStats({ college, dataset = 'real' }) {
  const match = { status: 'complete', shareWithCampus: true, isSample: dataset === 'sample' };
  const colleges = (await Analysis.distinct('college', match)).filter(Boolean).sort();
  if (college) match.college = college;

  const docs = await Analysis.find(match)
    .select('riskLevel riskScore createdAt stats')
    .sort({ createdAt: -1 })
    .limit(10000)
    .lean();

  const now = new Date();
  const total = docs.length;
  const count = (lvl) => docs.filter((d) => d.riskLevel === lvl).length;
  const high = count('High'), medium = count('Medium'), low = count('Low');
  const pct = (n) => (total ? Math.round((n / total) * 100) : 0);

  // 12-week trend
  const thisWeek = weekStart(now);
  const weeks = Array.from({ length: 12 }, (_, i) => new Date(thisWeek.getTime() - (11 - i) * 7 * DAY));
  const trend = weeks.map((w) => ({ weekStart: w.toISOString().slice(0, 10), Low: 0, Medium: 0, High: 0 }));
  for (const d of docs) {
    const ws = weekStart(new Date(d.createdAt)).toISOString().slice(0, 10);
    const row = trend.find((t) => t.weekStart === ws);
    if (row && row[d.riskLevel] !== undefined) row[d.riskLevel]++;
  }

  const signalCounts = new Map();
  const catCounts = new Map();
  const bucketCounts = new Map(BUCKET_ORDER.map((b) => [b, 0]));
  const domains = new Map();
  let paymentN = 0, freeN = 0, scoreSum = 0;

  for (const d of docs) {
    scoreSum += d.riskScore || 0;
    const s = d.stats || {};
    if (s.paymentRequested) paymentN++;
    if (s.freeEmail) freeN++;
    for (const k of s.signalIds || []) signalCounts.set(k, (signalCounts.get(k) || 0) + 1);
    for (const c of s.paymentCategories || []) catCounts.set(c, (catCounts.get(c) || 0) + 1);
    if (s.senderDomain) bucketCounts.set(ageBucket(s.senderDomainAgeDays), (bucketCounts.get(ageBucket(s.senderDomainAgeDays)) || 0) + 1);
    if (d.riskLevel === 'High' && s.senderDomain && !s.freeEmail) {
      const cur = domains.get(s.senderDomain) || { domain: s.senderDomain, count: 0, lastSeen: d.createdAt, ageDays: s.senderDomainAgeDays ?? null };
      cur.count++;
      if (new Date(d.createdAt) > new Date(cur.lastSeen)) cur.lastSeen = d.createdAt;
      domains.set(s.senderDomain, cur);
    }
  }

  const last7 = docs.filter((d) => now - new Date(d.createdAt) < 7 * DAY).length;
  const prev7 = docs.filter((d) => { const a = now - new Date(d.createdAt); return a >= 7 * DAY && a < 14 * DAY; }).length;

  return {
    dataset,
    college: college || null,
    colleges,
    totals: { total, high, medium, low, highPct: pct(high), paymentPct: pct(paymentN), freeEmailPct: pct(freeN), avgScore: total ? Math.round(scoreSum / total) : 0, last7, prev7 },
    trend,
    topSignals: [...signalCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([key, n]) => ({ key, label: SIGNAL_LABELS[key] || key, count: n, pct: pct(n) })),
    paymentCategories: [...catCounts.entries()].sort((a, b) => b[1] - a[1]).map(([label, n]) => ({ label, count: n })),
    domainAgeBuckets: BUCKET_ORDER.map((label) => ({ label, count: bucketCounts.get(label) || 0 })),
    flaggedDomains: [...domains.values()].sort((a, b) => b.count - a.count || new Date(b.lastSeen) - new Date(a.lastSeen)).slice(0, 15),
    generatedAt: now.toISOString(),
  };
}

export async function placementMeta() {
  const [real, sample, realColleges, sampleColleges] = await Promise.all([
    Analysis.countDocuments({ status: 'complete', shareWithCampus: true, isSample: false }),
    Analysis.countDocuments({ isSample: true }),
    Analysis.distinct('college', { status: 'complete', shareWithCampus: true, isSample: false }),
    Analysis.distinct('college', { isSample: true }),
  ]);
  return { counts: { real, sample }, colleges: { real: realColleges.filter(Boolean).sort(), sample: sampleColleges.filter(Boolean).sort() } };
}

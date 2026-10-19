import { Analysis } from '../models/Analysis.js';
import { levelForScore } from './verification/index.js';
import { SIGNAL_LABELS } from './signalLabels.js';
import { DISCLAIMERS } from './report.js';

// DEMONSTRATION ONLY. Every record is flagged isSample=true, uses invented domains, and is never mixed into real statistics.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SCAM_DOMAINS = ['nexora-careers.top', 'brightpath-hr.xyz', 'talentbridge-jobs.click', 'orbitsoft-recruit.icu', 'zenithworks-hiring.top', 'cloudnest-careers.buzz', 'pixelforge-hr.xyz', 'alphagrid-offers.work'];
const OKAY_DOMAINS = ['northwind-labs.example', 'harborline.example', 'kestrelsoft.example', 'meridian-data.example'];
const COLLEGES = ['Sample Engineering College', 'Sample Arts & Science College'];
const CATS = ['Registration / seat confirmation', 'Security / refundable deposit', 'Training / certification', 'Kit / laptop / equipment', 'Processing / verification'];

const SCENARIOS = [
  { w: 30, score: [62, 95], signals: ['payment', 'sender-type', 'urgency', 'guarantee'], pay: true, free: true },
  { w: 22, score: [55, 90], signals: ['payment', 'domain-age', 'identity-mismatch', 'urgency', 'domain-pattern'], pay: true, free: false, scam: true },
  { w: 8, score: [50, 75], signals: ['impersonation', 'domain-age', 'email-auth', 'messaging'], pay: false, free: false, scam: true },
  { w: 14, score: [22, 45], signals: ['urgency', 'email-auth', 'messaging'], pay: false, free: false },
  { w: 8, score: [20, 40], signals: ['sender-type', 'urgency'], pay: false, free: true },
  { w: 18, score: [0, 15], signals: [], pay: false, free: false },
];

export async function seedSamples({ count = 90, seed = 42 } = {}) {
  await Analysis.deleteMany({ isSample: true });
  const r = rng(seed);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const totalW = SCENARIOS.reduce((s, x) => s + x.w, 0);
  const docs = [];
  const now = Date.now();

  for (let i = 0; i < count; i++) {
    let roll = r() * totalW;
    const sc = SCENARIOS.find((s) => (roll -= s.w) < 0) || SCENARIOS[0];
    const score = Math.round(sc.score[0] + r() * (sc.score[1] - sc.score[0]));
    const level = levelForScore(score);
    // more recent weeks are busier (placement season)
    const ageDays = Math.floor(Math.pow(r(), 1.6) * 83);
    const createdAt = new Date(now - ageDays * 86_400_000 - Math.floor(r() * 80_000_000));
    const free = sc.free;
    const domain = free ? 'gmail.com' : sc.scam ? pick(SCAM_DOMAINS) : pick(OKAY_DOMAINS);
    const domainAge = free ? undefined : sc.scam ? 2 + Math.floor(r() * 70) : 400 + Math.floor(r() * 3000);
    docs.push({
      clientId: 'sample-data',
      isSample: true,
      college: pick(COLLEGES),
      shareWithCampus: true,
      language: 'en',
      status: 'complete',
      source: { type: 'text', textOrigin: 'sample' },
      riskLevel: level,
      riskScore: score,
      companyName: 'Sample record',
      stats: {
        signalIds: sc.signals,
        signalTitles: sc.signals.map((k) => SIGNAL_LABELS[k]),
        paymentRequested: sc.pay,
        paymentCategories: sc.pay ? [pick(CATS)] : [],
        freeEmail: free,
        senderDomain: domain,
        senderDomainAgeDays: domainAge,
        confidence: 'good',
      },
      verification: { score, ruleRiskLevel: level, checks: [], domains: [], counts: {}, confidence: 'good' },
      report: { riskLevel: level, headline: 'Sample record', summary: 'SAMPLE DATA for demonstration only. This is not a real verification.', reasons: [], nextSteps: [], generatedBy: 'sample', disclaimer: DISCLAIMERS.en, language: 'en' },
      createdAt,
      updatedAt: createdAt,
    });
  }
  await Analysis.create(docs);
  return docs.length;
}

export const removeSamples = async () => (await Analysis.deleteMany({ isSample: true })).deletedCount;

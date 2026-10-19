import test from 'node:test';
import assert from 'node:assert/strict';

process.env.LLM_PROVIDER = 'anthropic';
process.env.ANTHROPIC_API_KEY = 'test-key-not-real';

const { generateReport, ungroundedTokens } = await import('../src/services/report.js');
const { runVerification } = await import('../src/services/verification/index.js');
const { normalizeExtraction, groundExtraction, backfillFromText, extractOffer } = await import('../src/services/extraction.js');

const NOW = Date.parse('2026-10-11T00:00:00Z');
const deps = {
  now: NOW,
  rdapLookup: async () => ({ status: 'ok', registeredAt: new Date(NOW - 9 * 86400000).toISOString(), ageDays: 9, source: 'rdap.test', registrar: 'R' }),
  dnsReport: async () => ({ state: 'resolves', hasMail: true, nullMx: false, mx: ['mx.t.net'], a: ['203.0.113.1'], aaaa: [], ns: ['ns.t.net'], spf: 'missing', dmarc: 'missing', dmarcPolicy: null }),
  resolveHost: async () => ({ state: 'resolves', addresses: ['203.0.113.1'] }),
};
const mockLlm = (obj) => { globalThis.fetch = async () => new Response(JSON.stringify({ model: 'mock-model', content: [{ type: 'text', text: JSON.stringify(obj) }] }), { status: 200 }); };

const text = 'From: HR <hr@brightpath-jobs.top>\nPay a registration fee of Rs. 2000 via UPI within 24 hours to confirm your internship at Brightpath Systems.';
const ex = { ...normalizeExtraction({ companyName: 'Brightpath Systems', senderEmail: 'hr@brightpath-jobs.top', payments: [{ amount: '2000', currency: 'Rs.', purpose: 'registration fee', method: 'UPI', quote: 'registration fee of Rs. 2000' }] }) };

test('grounding drops emails/domains the model invented', () => {
  const e = normalizeExtraction({ senderEmail: 'ceo@made-up.com', contactEmails: ['hr@brightpath-jobs.top'], websiteDomains: ['invented.org'] });
  const dropped = groundExtraction(e, text);
  assert.equal(e.senderEmail, null);
  assert.deepEqual(e.contactEmails, ['hr@brightpath-jobs.top']);
  assert.ok(dropped.includes('ceo@made-up.com') && dropped.includes('invented.org'));
  backfillFromText(e, text);
  assert.equal(e.senderEmail, 'hr@brightpath-jobs.top'); // recovered deterministically from the From: line
});

test('ungroundedTokens flags facts that are not in the evidence', () => {
  const blob = JSON.stringify({ domain: 'brightpath-jobs.top', fee: '2000' });
  assert.deepEqual(ungroundedTokens('The domain brightpath-jobs.top asked for 2,000 rupees.', blob), []);
  assert.ok(ungroundedTokens('The company also owns evil-twin.com', blob).includes('evil-twin.com'));
  assert.ok(ungroundedTokens('They asked for 50000 rupees', blob).includes('50000'));
});

test('AI report: invented statements removed, risk level clamped to one step from the rules', async () => {
  const v = await runVerification(ex, text, deps);
  assert.equal(v.ruleRiskLevel, 'High');
  mockLlm({
    riskLevel: 'Low', // 2 levels below the rules → must be clamped to Medium, and never below
    headline: 'Looks risky', summary: 'The sender domain brightpath-jobs.top is new and a payment is requested.',
    reasons: [
      { text: 'A payment is requested from the candidate.', evidenceIds: ['payment-request'] },
      { text: 'The domain brightpath-jobs.top is only 9 days old.', evidenceIds: ['rdap-brightpath-jobs.top'] },
      { text: 'The firm is registered in Delaware under number 99887766.', evidenceIds: ['payment-request'] }, // invented
      { text: 'Not backed by an evidence id.', evidenceIds: ['does-not-exist'] },
    ],
    nextSteps: ['Do not pay.', 'Verify on the official website.', 'Show the placement cell.', 'Report at cybercrime.gov.in'],
  });
  const r = await generateReport(ex, v, 'en');
  assert.equal(r.generatedBy, 'ai');
  assert.equal(r.riskLevel, 'Medium');
  assert.equal(r.riskLevelSource, 'ai-clamped');
  assert.equal(r.reasons.length, 2);
  assert.ok(r.groundingRemoved >= 2);
  assert.match(r.disclaimer, /not a legal verdict/);
});

test('AI unavailable → deterministic fallback with disclaimer, no crash', async () => {
  const v = await runVerification(ex, text, deps);
  globalThis.fetch = async () => { throw Object.assign(new Error('fetch failed'), { cause: { code: 'ENOTFOUND' } }); };
  const r = await generateReport(ex, v, 'ta');
  assert.equal(r.generatedBy, 'rules-fallback');
  assert.equal(r.riskLevel, v.ruleRiskLevel);
  assert.ok(r.llmError);
  assert.ok(r.languageNote);
  assert.ok(r.nextSteps.length >= 3);
});

test('extractOffer end-to-end with mocked vision/text LLM', async () => {
  mockLlm({ companyName: 'Brightpath Systems', senderEmail: 'hr@brightpath-jobs.top', websiteDomains: ['not-in-text.com'], payments: [], documentLegibility: 'good', transcription: '' });
  const out = await extractOffer({ text });
  assert.equal(out.extraction.senderEmail, 'hr@brightpath-jobs.top');
  assert.ok(!out.extraction.websiteDomains.includes('not-in-text.com'));
  assert.equal(out.model, 'mock-model');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { runVerification } from '../src/services/verification/index.js';
import { detectPayment, detectUrgency } from '../src/services/verification/signals.js';
import { matchCompanyToDomain, brandImpersonation } from '../src/services/verification/heuristics.js';
import { extractEmails, registrableDomain, normalizeHost } from '../src/utils/domain.js';

const NOW = Date.parse('2026-10-11T00:00:00Z');
const okDns = { state: 'resolves', hasMail: true, nullMx: false, mx: ['mx.example-mail.net'], a: ['203.0.113.7'], aaaa: [], ns: ['ns1.x.net'], spf: 'present', dmarc: 'present', dmarcPolicy: 'reject' };
const fakeDeps = (ageDays, dns = okDns) => ({
  now: NOW,
  rdapLookup: async () => ageDays == null ? { status: 'unavailable', error: 'RDAP lookup timed out after 8s' } : { status: 'ok', registeredAt: new Date(NOW - ageDays * 86400000).toISOString(), ageDays, registrar: 'Test Registrar', source: 'rdap.test' },
  dnsReport: async () => dns,
  resolveHost: async () => ({ state: 'resolves', addresses: ['203.0.113.7'] }),
});
const base = { companyName: 'Brightpath Systems', payments: [], deadlines: [], contactEmails: [], websiteDomains: [], phoneNumbers: [], messagingHandles: [], requestedSensitiveInfo: [] };

test('scam-like offer: free email + payment + urgency => High', async () => {
  const text = 'Congratulations! You are selected without interview. Pay a refundable registration fee of Rs. 1500 via UPI within 24 hours.';
  const v = await runVerification({ ...base, senderEmail: 'hr.brightpath@gmail.com', payments: [{ amount: '1500', currency: '₹', purpose: 'registration fee', refundable: true, quote: 'registration fee of Rs. 1500' }] }, text, fakeDeps(10));
  assert.equal(v.ruleRiskLevel, 'High');
  const ids = v.checks.map((c) => c.id);
  for (const id of ['sender-free', 'payment-request', 'urgency', 'guarantee']) assert.ok(ids.includes(id), id);
  assert.ok(v.paymentCategories.includes('Registration / seat confirmation'));
});

test('new domain + mismatch is flagged using RDAP age (verified group)', async () => {
  const v = await runVerification({ ...base, senderEmail: 'hr@talent-desk.top' }, 'Please reply to confirm your internship at Brightpath Systems.', fakeDeps(12));
  const age = v.checks.find((c) => c.id === 'rdap-talent-desk.top');
  assert.equal(age.group, 'verified'); assert.equal(age.points, 35);
  assert.ok(v.checks.find((c) => c.id === 'mismatch-company-sender'));
  assert.ok(['Medium', 'High'].includes(v.ruleRiskLevel));
});

test('established matching domain with no red flags => Low', async () => {
  const v = await runVerification({ ...base, companyName: 'Brightpath Systems Pvt Ltd', senderEmail: 'careers@brightpath.in', websiteDomains: ['brightpath.in'] }, 'We are pleased to offer you a software internship. Your stipend is paid monthly. Join us on 1 Nov.', fakeDeps(2400));
  assert.equal(v.ruleRiskLevel, 'Low');
  assert.equal(v.score, 0);
});

test('failed RDAP is reported as unavailable, never as a pass', async () => {
  const v = await runVerification({ ...base, senderEmail: 'hr@brightpath.in' }, 'Hello', fakeDeps(null));
  const c = v.checks.find((x) => x.id === 'rdap-brightpath.in');
  assert.equal(c.group, 'unavailable');
  assert.equal(v.confidence, 'partial');
});

test('brand impersonation is detected, official domain is not', async () => {
  assert.equal(brandImpersonation('infosys-careers.in').key, 'infosys');
  assert.equal(brandImpersonation('infosys.com'), null);
  assert.equal(brandImpersonation('tcs.com.apply-now.xyz').key, 'tcs');
  assert.equal(brandImpersonation('tcsolutions.in'), null);
});

test('lookalike company domain', () => {
  assert.equal(matchCompanyToDomain('Brightpath Systems', 'brightpth.com').result, 'lookalike');
  assert.equal(matchCompanyToDomain('Brightpath Systems', 'brightpath.in').result, 'match');
  assert.equal(matchCompanyToDomain('Acme Technologies', 'zzzhr.com').result, 'none');
});

test('negated fee wording is not treated as a payment request', () => {
  assert.equal(detectPayment('We never charge any registration fee from candidates.').strong.length, 0);
  assert.ok(detectPayment('Please pay a security deposit of ₹5,000 to confirm.').strong.length > 0);
  assert.equal(detectPayment('Your stipend will be credited via NEFT on the 1st.').methods.length, 0);
  assert.ok(detectUrgency('Reply within 24 hours or the offer will lapse.').matched);
});

test('domain helpers', () => {
  assert.equal(registrableDomain('careers.acme.co.in'), 'acme.co.in');
  assert.equal(normalizeHost('http://127.0.0.1/x'), null);
  assert.deepEqual(extractEmails('Write to HR@Acme.com.'), ['hr@acme.com']);
});

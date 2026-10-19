// Pattern-based detectors that run on the offer text (pasted text, PDF text layer, or the LLM's transcription of an image).
// These are heuristics: they produce *suspicious signals with quoted evidence*, never "verified facts".

const NEGATION_BEFORE = /\b(no|not|never|without|nor|neither|zero|don'?t|doesn'?t|isn'?t|won'?t|free\s+of|free\s+from)\b[^.!?\n]{0,45}$/i;
const NORMAL_PAY_CONTEXT = /\b(salary|stipend|ctc|credited|will be paid to you|payout|reimburse)/i;

function snippet(text, start, end, pad = 50) {
  const s = Math.max(0, start - pad);
  const e = Math.min(text.length, end + pad);
  return (s > 0 ? '…' : '') + text.slice(s, e).replace(/\s+/g, ' ').trim() + (e < text.length ? '…' : '');
}

function collect(text, regexes, { checkNegation = false, maxMatches = 6 } = {}) {
  const found = [];
  const seen = new Set();
  for (const re of regexes) {
    const rx = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
    for (const m of text.matchAll(rx)) {
      const start = m.index;
      const before = text.slice(Math.max(0, start - 60), start);
      if (checkNegation && NEGATION_BEFORE.test(before)) continue;
      const key = m[0].toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      found.push({ phrase: m[0].replace(/\s+/g, ' ').trim(), snippet: snippet(text, start, start + m[0].length) });
      if (found.length >= maxMatches) return found;
    }
  }
  return found;
}

const FEE_WORDS =
  'registration|processing|training|security|refundable|onboarding|verification|administrative|admin|joining|documentation|document|kit|laptop|id card|certificate|courier|insurance|interview|application|background check|software|equipment|assessment|confirmation|booking|seat|portal|uniform|induction|offer letter';

const PAYMENT_STRONG = [
  new RegExp(`\\b(?:${FEE_WORDS})\\s+(?:fee|fees|charge|charges|deposit|amount|payment|cost)\\b`, 'gi'),
  /\b(?:pay|deposit|transfer|remit|send)\b[^.\n]{0,60}?(?:₹|rs\.?|inr|usd|\$|rupees|dollars)\s?[\d,]+/gi,
  /(?:₹|rs\.?\s?|inr\s?|\$)\s?\d[\d,]{2,}\s?(?:\/-)?[^.\n]{0,40}\b(?:fee|deposit|charges?|payment|refundable)\b/gi,
  /\bpay\s+(?:the\s+)?(?:fee|amount|money|deposit)\b/gi,
];

const PAYMENT_METHODS =
  /\b(upi|gpay|google pay|phonepe|paytm|bhim|net ?banking|neft|imps|rtgs|western union|moneygram|gift cards?|bitcoin|crypto(?:currency)?|usdt)\b/gi;

export function detectPayment(text) {
  const strong = collect(text, PAYMENT_STRONG, { checkNegation: true });
  const methodsAll = collect(text, [PAYMENT_METHODS], { maxMatches: 8 });
  const methods = methodsAll.filter((m) => {
    const ctx = m.snippet;
    return /\b(pay|send|transfer|deposit|remit|scan|qr)\b/i.test(ctx) && !NORMAL_PAY_CONTEXT.test(ctx);
  });
  return { strong, methods, matched: strong.length > 0 || methods.length > 0 };
}

const URGENCY = [
  /\b(?:within|in|before|by)\s+(?:the\s+next\s+)?(?:\d{1,2}|one|two|three|twenty[- ]four|forty[- ]eight|seventy[- ]two)\s*(?:hours?|hrs?|days?)\b/gi,
  /\b(?:immediately|urgent(?:ly)?|asap|right away|at the earliest|last (?:date|chance|day)|limited (?:seats|slots|vacancies|positions|time)|hurry|today only|offer (?:will )?(?:lapse|expire|be cancelled|be withdrawn|be forfeited)|failing which|final reminder|act now|do not delay|don'?t delay|only \d+ (?:seats|slots) left)\b/gi,
  /\b(?:expires?|expiry)\s+(?:today|tonight|tomorrow|soon)\b/gi,
];
export function detectUrgency(text) {
  const matches = collect(text, URGENCY, { maxMatches: 6 });
  return { matches, matched: matches.length > 0 };
}

// Credentials that no legitimate employer asks for
const CREDENTIALS = /\b(otp|one[- ]time password|cvv|atm pin|card pin|upi pin|net ?banking (?:password|login)|password|card number|debit card|credit card)\b/gi;
// Identity/bank details — legitimate onboarding sometimes asks for these, but only AFTER verified joining
const IDENTITY = /\b(aadhaar|aadhar|pan (?:card|number)|passport|bank (?:account|details|passbook|statement)|account number|ifsc|selfie with|signature scan)\b/gi;

export function detectSensitive(text) {
  const credentials = collect(text, [CREDENTIALS], { checkNegation: true });
  const identity = collect(text, [IDENTITY], { checkNegation: true });
  return { credentials, identity };
}

const MESSAGING_RE =
  /\b(?:whatsapp|telegram|signal)\b[^.\n]{0,60}\b(?:contact|message|chat|join|apply|reach|number|group|channel|only)\b|\b(?:contact|message|chat|join|reach|apply)\b[^.\n]{0,60}\b(?:whatsapp|telegram)\b/gi;
export function detectMessaging(text, handles = []) {
  const matches = collect(text, [MESSAGING_RE], { maxMatches: 3 });
  return { matches, handles, matched: matches.length > 0 };
}

const NO_INTERVIEW =
  /\b(?:no interview|without (?:an? )?interview|direct(?:ly)? selected|selected without|no (?:test|exam|written test|selection process)|100% (?:selection|placement|job guarantee)|guaranteed (?:job|placement|selection|offer))\b/gi;
export function detectGuarantee(text) {
  const matches = collect(text, [NO_INTERVIEW], { maxMatches: 3 });
  return { matches, matched: matches.length > 0 };
}

// SPF/DKIM/DMARC results from pasted raw headers
export function parseAuthResults(text) {
  const m = text.match(/Authentication-Results:[\s\S]{0,800}/i);
  if (!m) return null;
  const block = m[0];
  const grab = (k) => (block.match(new RegExp(`\\b${k}=(pass|fail|softfail|neutral|none|temperror|permerror|bestguesspass|policy)`, 'i')) || [])[1]?.toLowerCase() || null;
  const res = { spf: grab('spf'), dkim: grab('dkim'), dmarc: grab('dmarc') };
  return res.spf || res.dkim || res.dmarc ? res : null;
}

export function classifyPaymentPurpose(purpose = '') {
  const p = purpose.toLowerCase();
  if (/security|deposit|refundable/.test(p)) return 'Security / refundable deposit';
  if (/regist|enrol|seat|booking|confirm/.test(p)) return 'Registration / seat confirmation';
  if (/train|course|certif|assessment|induct/.test(p)) return 'Training / certification';
  if (/kit|laptop|equipment|uniform|id card|software/.test(p)) return 'Kit / laptop / equipment';
  if (/process|admin|document|verif|background|courier|insur/.test(p)) return 'Processing / verification';
  return 'Other / unspecified';
}

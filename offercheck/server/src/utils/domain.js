import { domainToASCII } from 'node:url';

// Second-level public suffixes we need for common registrable-domain parsing.
// (Deliberately small and dependency-free; RDAP is queried on the registrable domain.)
const MULTI_PART_SUFFIXES = new Set([
  'co.in', 'ac.in', 'edu.in', 'org.in', 'net.in', 'gov.in', 'nic.in', 'res.in', 'firm.in', 'gen.in', 'ind.in',
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk',
  'com.au', 'net.au', 'org.au', 'edu.au', 'co.nz', 'co.za', 'com.sg', 'com.my', 'com.br', 'com.cn', 'com.hk',
  'co.jp', 'co.kr', 'com.pk', 'com.bd', 'com.lk', 'com.np', 'com.ng', 'co.ke', 'com.ph', 'com.vn', 'com.tr',
]);

const RESERVED_TLDS = new Set([
  'local', 'localhost', 'internal', 'lan', 'home', 'corp', 'test', 'invalid', 'example', 'intranet', 'private', 'onion',
]);

// Used only when a domain appears without a scheme or "www." (to avoid treating "offer.pdf" as a domain)
const COMMON_TLDS = new Set([
  'com', 'in', 'org', 'net', 'co', 'io', 'ai', 'xyz', 'info', 'biz', 'online', 'site', 'top', 'shop', 'club', 'tech',
  'app', 'dev', 'edu', 'gov', 'me', 'us', 'uk', 'ac', 'work', 'click', 'link', 'live', 'store', 'cloud', 'pro',
  'career', 'careers', 'jobs', 'icu', 'buzz', 'cyou', 'rest', 'monster', 'tk', 'ml', 'ga', 'cf', 'gq', 'ly', 'gl', 'to',
  'cc', 'ws', 'vip', 'one', 'space', 'website', 'digital', 'solutions', 'services', 'company', 'agency', 'network',
]);

const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

/** Normalise a URL / email / hostname into a lowercase ASCII hostname (no www.), or null if not a plausible public domain. */
export function normalizeHost(input) {
  if (typeof input !== 'string') return null;
  let s = input.trim().toLowerCase();
  if (!s || s.length > 300) return null;
  s = s.replace(/^mailto:/, '');
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  s = s.split(/[/?#\s]/)[0];
  if (s.includes('@')) s = s.split('@').pop();
  s = s.replace(/:\d+$/, '').replace(/\.+$/, '').replace(/^www\./, '');
  if (!s) return null;
  const ascii = domainToASCII(s);
  if (!ascii || ascii.length > 253) return null;
  const labels = ascii.split('.');
  if (labels.length < 2) return null;
  if (!labels.every((l) => LABEL.test(l))) return null;
  const tld = labels[labels.length - 1];
  if (RESERVED_TLDS.has(tld)) return null;
  if (!/^([a-z]{2,24}|xn--[a-z0-9-]{2,59})$/.test(tld)) return null; // also rejects raw IP addresses
  return ascii;
}

/** acme.co.in → acme.co.in ; careers.acme.com → acme.com */
export function registrableDomain(host) {
  const h = normalizeHost(host);
  if (!h) return null;
  const labels = h.split('.');
  const last2 = labels.slice(-2).join('.');
  if (labels.length >= 3 && MULTI_PART_SUFFIXES.has(last2)) return labels.slice(-3).join('.');
  return last2;
}

export function domainLabel(registrable) {
  return registrable ? registrable.split('.')[0] : '';
}

export function tldOf(host) {
  const h = normalizeHost(host);
  return h ? h.split('.').pop() : null;
}

export function emailDomain(email) {
  if (typeof email !== 'string' || !email.includes('@')) return null;
  return normalizeHost(email.split('@').pop());
}

export function isPlausibleEmail(email) {
  return typeof email === 'string' && /^[a-z0-9._%+-]{1,64}@[a-z0-9.-]+\.[a-z]{2,24}$/i.test(email.trim()) && !!emailDomain(email);
}

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi;

export function extractEmails(text) {
  if (!text) return [];
  const out = new Set();
  for (const m of text.matchAll(EMAIL_RE)) {
    const e = m[0].replace(/[.,;:)>\]]+$/, '').toLowerCase();
    if (isPlausibleEmail(e)) out.add(e);
  }
  return [...out];
}

const URL_RE = /\b(?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,24}(?:\/[^\s<>"')\]]*)?/gi;

/** Hostnames mentioned in free text (emails are removed first). */
export function extractWebHosts(text) {
  if (!text) return [];
  const cleaned = text.replace(EMAIL_RE, ' ');
  const out = new Set();
  for (const m of cleaned.matchAll(URL_RE)) {
    const raw = m[0].replace(/[.,;:)>\]]+$/, '');
    const hasScheme = /^https?:\/\//i.test(raw);
    const hasWww = /^www\./i.test(raw);
    const host = normalizeHost(raw);
    if (!host) continue;
    const tld = host.split('.').pop();
    if (hasScheme || hasWww || COMMON_TLDS.has(tld)) out.add(host);
  }
  return [...out];
}

export function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

import { domainLabel, levenshtein, normalizeHost, registrableDomain } from '../../utils/domain.js';

const COMPANY_STOPWORDS = new Set([
  'pvt', 'private', 'ltd', 'limited', 'inc', 'incorporated', 'llc', 'llp', 'plc', 'corp', 'corporation', 'company', 'co',
  'technologies', 'technology', 'tech', 'solutions', 'services', 'systems', 'software', 'group', 'global', 'india',
  'labs', 'consulting', 'infotech', 'softech', 'industries', 'enterprises', 'the', 'and', 'of', 'international',
  'infosystems', 'digital', 'innovations', 'ventures', 'studio', 'studios',
]);

export function companyTokens(name) {
  if (!name) return [];
  return name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t && !COMPANY_STOPWORDS.has(t));
}

/**
 * Does the domain plausibly belong to the claimed company?
 * @returns {{result:'match'|'lookalike'|'none'|'unknown', detail:string}}
 */
export function matchCompanyToDomain(companyName, registrable) {
  const tokens = companyTokens(companyName);
  if (!tokens.length || !registrable) return { result: 'unknown', detail: 'Company name or domain missing.' };
  const label = domainLabel(registrable).replace(/-/g, '');
  const joined = tokens.join('');
  const acronym = tokens.length >= 2 ? tokens.map((t) => t[0]).join('') : '';

  if (label === joined) return { result: 'match', detail: 'Domain name equals company name.' };
  if (tokens.some((t) => t.length >= 3 && label.includes(t))) return { result: 'match', detail: 'Domain contains a word from the company name.' };
  if (label.length >= 3 && joined.includes(label)) return { result: 'match', detail: 'Domain is part of the company name.' };
  if (acronym.length >= 2 && (label === acronym || label.startsWith(acronym))) return { result: 'match', detail: 'Domain matches the company initials.' };

  const candidates = [joined, ...tokens.filter((t) => t.length >= 5)];
  for (const c of candidates) {
    if (c.length < 5) continue;
    const d = levenshtein(label, c);
    if (d >= 1 && d <= 2 && d / c.length <= 0.25) {
      return { result: 'lookalike', detail: `Domain "${label}" differs from "${c}" by only ${d} character${d > 1 ? 's' : ''}.` };
    }
  }
  return { result: 'none', detail: 'No word in the company name appears in the domain.' };
}

// Built-in list of well-known employers and their registrable domains. Intentionally incomplete.
export const KNOWN_BRANDS = [
  { key: 'google', name: 'Google', domains: ['google.com', 'withgoogle.com'] },
  { key: 'microsoft', name: 'Microsoft', domains: ['microsoft.com'] },
  { key: 'amazon', name: 'Amazon', domains: ['amazon.com', 'amazon.in', 'amazon.jobs', 'a2z.com'] },
  { key: 'infosys', name: 'Infosys', domains: ['infosys.com'] },
  { key: 'tcs', name: 'Tata Consultancy Services (TCS)', domains: ['tcs.com'] },
  { key: 'wipro', name: 'Wipro', domains: ['wipro.com'] },
  { key: 'cognizant', name: 'Cognizant', domains: ['cognizant.com'] },
  { key: 'accenture', name: 'Accenture', domains: ['accenture.com'] },
  { key: 'capgemini', name: 'Capgemini', domains: ['capgemini.com'] },
  { key: 'hcltech', name: 'HCLTech', domains: ['hcltech.com', 'hcl.com'] },
  { key: 'techmahindra', name: 'Tech Mahindra', domains: ['techmahindra.com'] },
  { key: 'ltimindtree', name: 'LTIMindtree', domains: ['ltimindtree.com', 'mindtree.com'] },
  { key: 'ibm', name: 'IBM', domains: ['ibm.com'] },
  { key: 'oracle', name: 'Oracle', domains: ['oracle.com'] },
  { key: 'deloitte', name: 'Deloitte', domains: ['deloitte.com'] },
  { key: 'zoho', name: 'Zoho', domains: ['zoho.com', 'zohocorp.com'] },
  { key: 'freshworks', name: 'Freshworks', domains: ['freshworks.com'] },
  { key: 'flipkart', name: 'Flipkart', domains: ['flipkart.com'] },
  { key: 'paytm', name: 'Paytm', domains: ['paytm.com'] },
  { key: 'swiggy', name: 'Swiggy', domains: ['swiggy.in', 'swiggy.com'] },
  { key: 'zomato', name: 'Zomato', domains: ['zomato.com'] },
  { key: 'intel', name: 'Intel', domains: ['intel.com'] },
  { key: 'nvidia', name: 'NVIDIA', domains: ['nvidia.com'] },
  { key: 'adobe', name: 'Adobe', domains: ['adobe.com'] },
  { key: 'cisco', name: 'Cisco', domains: ['cisco.com'] },
  { key: 'kpmg', name: 'KPMG', domains: ['kpmg.com'] },
  { key: 'pwc', name: 'PwC', domains: ['pwc.com', 'pwc.in'] },
  { key: 'ey', name: 'EY', domains: ['ey.com'] },
];

/** Which known brand does the claimed company name refer to? */
export function brandForCompany(companyName) {
  const tokens = companyTokens(companyName);
  const joined = tokens.join('');
  const raw = (companyName || '').toLowerCase();
  for (const b of KNOWN_BRANDS) {
    if (tokens.includes(b.key) || joined === b.key) return b;
  }
  if (/tata consultancy/.test(raw)) return KNOWN_BRANDS.find((b) => b.key === 'tcs');
  if (/tech ?mahindra/.test(raw)) return KNOWN_BRANDS.find((b) => b.key === 'techmahindra');
  if (/\bhcl\b/.test(raw)) return KNOWN_BRANDS.find((b) => b.key === 'hcltech');
  if (/ernst/.test(raw)) return KNOWN_BRANDS.find((b) => b.key === 'ey');
  return null;
}

/** Does this host *contain* a brand's name while not being one of its domains? (e.g. infosys-careers.in, tcs.com.apply-now.xyz) */
export function brandImpersonation(host) {
  const h = normalizeHost(host);
  if (!h) return null;
  const reg = registrableDomain(h);
  for (const b of KNOWN_BRANDS) {
    if (b.domains.includes(reg)) continue;
    const hasKey =
      b.key.length <= 3 ? new RegExp(`(^|[.-])${b.key}([.-]|$)`).test(h) : h.replace(/-/g, '').includes(b.key);
    if (hasKey) return b;
  }
  return null;
}

export const isOfficialBrandDomain = (brand, registrable) => !!brand && brand.domains.includes(registrable);

const SUSPICIOUS_TLDS = new Set([
  'tk', 'ml', 'ga', 'cf', 'gq', 'xyz', 'top', 'click', 'icu', 'buzz', 'cyou', 'rest', 'monster', 'work', 'link', 'zip',
  'mov', 'country', 'stream', 'download', 'loan', 'men', 'win', 'bid', 'party', 'review', 'trade', 'cam',
]);
export const isSuspiciousTld = (host) => SUSPICIOUS_TLDS.has((host || '').split('.').pop());

const JOB_WORDS = /(career|careers|hiring|recruit|recruitment|jobs?|offer|placement|internship|selection|hr)/;
export function jobThemedDomain(registrable) {
  const label = domainLabel(registrable);
  const m = label.match(JOB_WORDS);
  return m && label.length > m[0].length + 2 ? m[0] : null;
}

// Hosts that are generic platforms; they don't tell us anything about company ownership.
const GENERIC_HOSTS = new Set([
  'linkedin.com', 'facebook.com', 'instagram.com', 'twitter.com', 'x.com', 'youtube.com', 'forms.gle', 'google.com',
  'docs.google.com', 'drive.google.com', 'github.com', 'wikipedia.org', 't.me', 'wa.me', 'whatsapp.com', 'telegram.org',
  'naukri.com', 'indeed.com', 'internshala.com', 'glassdoor.com', 'unstop.com', 'zoom.us', 'calendly.com', 'typeform.com',
]);
const SHORTENERS = new Set(['bit.ly', 'tinyurl.com', 't.co', 'cutt.ly', 'rb.gy', 'is.gd', 'goo.gl', 'shorturl.at', 'ow.ly', 'rebrand.ly', 'tiny.cc']);
export const isGenericHost = (registrable) => GENERIC_HOSTS.has(registrable);
export const isShortener = (registrable) => SHORTENERS.has(registrable);

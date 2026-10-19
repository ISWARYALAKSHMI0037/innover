import { config } from '../../config.js';

const BOOTSTRAP_URL = 'https://data.iana.org/rdap/dns.json';
const DAY = 86_400_000;

let bootstrapCache = { at: 0, map: null };
const resultCache = new Map(); // domain → {at, value}

async function fetchJson(url, timeoutMs) {
  const res = await fetch(url, {
    headers: { Accept: 'application/rdap+json, application/json', 'User-Agent': 'OfferCheck/1.0 (+student-safety-tool)' },
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
  });
  return res;
}

async function loadBootstrap(timeoutMs) {
  if (bootstrapCache.map && Date.now() - bootstrapCache.at < DAY) return bootstrapCache.map;
  const res = await fetchJson(BOOTSTRAP_URL, timeoutMs);
  if (!res.ok) throw new Error(`IANA RDAP bootstrap returned HTTP ${res.status}`);
  const data = await res.json();
  const map = new Map();
  for (const [tlds, urls] of data.services || []) {
    const https = (urls || []).find((u) => u.startsWith('https://')) || urls?.[0];
    if (!https) continue;
    for (const t of tlds) map.set(t.toLowerCase(), https.endsWith('/') ? https : https + '/');
  }
  bootstrapCache = { at: Date.now(), map };
  return map;
}

const pickEvent = (events = [], ...actions) => {
  const e = events.find((ev) => actions.includes((ev.eventAction || '').toLowerCase()));
  const t = e?.eventDate ? Date.parse(e.eventDate) : NaN;
  return Number.isFinite(t) ? new Date(t) : null;
};

function registrarName(entities = []) {
  for (const ent of entities) {
    if ((ent.roles || []).includes('registrar')) {
      const fn = ent.vcardArray?.[1]?.find((p) => p[0] === 'fn');
      if (fn?.[3]) return String(fn[3]).slice(0, 120);
      const pub = ent.publicIds?.[0]?.identifier;
      if (pub) return `IANA registrar ${pub}`;
    }
    const nested = registrarName(ent.entities || []);
    if (nested) return nested;
  }
  return null;
}

/**
 * Real RDAP lookup. Never throws.
 * @returns {Promise<{status:'ok'|'not_found'|'unavailable', registeredAt?:string, expiresAt?:string, lastChangedAt?:string,
 *   ageDays?:number, registrar?:string, nameservers?:string[], statuses?:string[], source?:string, error?:string}>}
 */
export async function rdapLookup(domain, { timeoutMs = config.rdapTimeoutMs, now = Date.now() } = {}) {
  const cached = resultCache.get(domain);
  if (cached && now - cached.at < 6 * 3600_000 && cached.value.status !== 'unavailable') return cached.value;

  let base;
  try {
    const map = await loadBootstrap(timeoutMs);
    base = map.get(domain.split('.').pop());
  } catch {
    base = null; // bootstrap unreachable → fall back to the public rdap.org redirector
  }
  if (!base) base = 'https://rdap.org/';

  const url = `${base}domain/${encodeURIComponent(domain)}`;
  try {
    const res = await fetchJson(url, timeoutMs);
    if (res.status === 404) {
      const value = { status: 'not_found', source: new URL(url).host };
      resultCache.set(domain, { at: now, value });
      return value;
    }
    if (!res.ok) {
      return { status: 'unavailable', error: res.status === 429 ? 'RDAP server rate-limited this request (HTTP 429)' : `RDAP server returned HTTP ${res.status}`, source: new URL(url).host };
    }
    const data = await res.json();
    const registered = pickEvent(data.events, 'registration');
    const expires = pickEvent(data.events, 'expiration');
    const changed = pickEvent(data.events, 'last changed');
    if (!registered) {
      return { status: 'unavailable', error: 'RDAP record has no registration date (some registries redact it)', source: new URL(url).host };
    }
    if (registered.getTime() > now + DAY) {
      return { status: 'unavailable', error: 'RDAP returned a registration date in the future; ignoring it', source: new URL(url).host };
    }
    const value = {
      status: 'ok',
      registeredAt: registered.toISOString(),
      expiresAt: expires?.toISOString(),
      lastChangedAt: changed?.toISOString(),
      ageDays: Math.max(0, Math.floor((now - registered.getTime()) / DAY)),
      registrar: registrarName(data.entities),
      nameservers: (data.nameservers || []).map((n) => String(n.ldhName || '').toLowerCase()).filter(Boolean).slice(0, 6),
      statuses: (data.status || []).slice(0, 8),
      source: new URL(res.url || url).host,
    };
    resultCache.set(domain, { at: now, value });
    return value;
  } catch (err) {
    const timeout = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    return { status: 'unavailable', error: timeout ? `RDAP lookup timed out after ${timeoutMs / 1000}s` : `RDAP lookup failed (${err?.cause?.code || err?.message || 'network error'})`, source: (() => { try { return new URL(url).host; } catch { return undefined; } })() };
  }
}

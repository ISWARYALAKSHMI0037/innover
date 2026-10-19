import { Resolver } from 'node:dns/promises';
import { config } from '../../config.js';

function makeResolver(timeoutMs) {
  const r = new Resolver({ timeout: timeoutMs, tries: 2 });
  return r;
}

// Node: ENOTFOUND = NXDOMAIN, ENODATA = name exists but no record of that type.
async function q(fn) {
  try {
    const records = await fn();
    return { status: 'ok', records };
  } catch (err) {
    const code = err?.code || '';
    if (code === 'ENOTFOUND') return { status: 'nxdomain', records: [] };
    if (code === 'ENODATA') return { status: 'none', records: [] };
    return { status: 'error', records: [], error: code || err?.message || 'DNS error' };
  }
}

const txtJoin = (rows) => rows.map((chunks) => chunks.join(''));

/**
 * Real DNS lookups for a registrable domain. Never throws.
 */
export async function dnsReport(domain, { timeoutMs = config.dnsTimeoutMs } = {}) {
  const r = makeResolver(timeoutMs);
  const [mx, a, aaaa, ns, txt, dmarcTxt] = await Promise.all([
    q(() => r.resolveMx(domain)),
    q(() => r.resolve4(domain)),
    q(() => r.resolve6(domain)),
    q(() => r.resolveNs(domain)),
    q(async () => txtJoin(await r.resolveTxt(domain))),
    q(async () => txtJoin(await r.resolveTxt(`_dmarc.${domain}`))),
  ]);

  const all = [mx, a, aaaa, ns, txt];
  const allErrored = all.every((x) => x.status === 'error');
  const someOk = all.some((x) => x.status === 'ok');
  const allNx = [mx, a, aaaa, ns].every((x) => x.status === 'nxdomain');

  const nullMx = mx.status === 'ok' && mx.records.length > 0 && mx.records.every((m) => !m.exchange || m.exchange === '.');
  const mxRecords = mx.status === 'ok' ? mx.records.filter((m) => m.exchange && m.exchange !== '.').sort((x, y) => x.priority - y.priority) : [];
  const hasMail = mxRecords.length > 0 || (a.status === 'ok' && a.records.length > 0 && mx.status !== 'ok' && !nullMx);

  const spfRecord = txt.status === 'ok' ? txt.records.find((t) => /^v=spf1\b/i.test(t)) : null;
  const dmarcRecord = dmarcTxt.status === 'ok' ? dmarcTxt.records.find((t) => /^v=DMARC1\b/i.test(t)) : null;
  const dmarcPolicy = dmarcRecord ? (dmarcRecord.match(/\bp=(none|quarantine|reject)/i) || [])[1]?.toLowerCase() || null : null;

  let state;
  if (allErrored) state = 'unavailable';
  else if (allNx) state = 'nxdomain';
  else if (someOk) state = 'resolves';
  else state = 'no_records';

  return {
    state, // unavailable | nxdomain | no_records | resolves
    error: allErrored ? [mx, a, aaaa, ns, txt].find((x) => x.error)?.error : undefined,
    hasMail,
    nullMx,
    mx: mxRecords.slice(0, 4).map((m) => m.exchange),
    a: a.status === 'ok' ? a.records.slice(0, 4) : [],
    aaaa: aaaa.status === 'ok' ? aaaa.records.slice(0, 2) : [],
    ns: ns.status === 'ok' ? ns.records.slice(0, 4) : [],
    spf: txt.status === 'error' ? 'unknown' : spfRecord ? 'present' : 'missing',
    dmarc: dmarcTxt.status === 'error' ? 'unknown' : dmarcRecord ? 'present' : 'missing',
    dmarcPolicy,
  };
}

/** Does this exact host resolve to an IP address? */
export async function resolveHost(host, { timeoutMs = config.dnsTimeoutMs } = {}) {
  const r = makeResolver(timeoutMs);
  const [a, aaaa] = await Promise.all([q(() => r.resolve4(host)), q(() => r.resolve6(host))]);
  if (a.status === 'ok' || aaaa.status === 'ok') return { state: 'resolves', addresses: [...(a.records || []), ...(aaaa.records || [])].slice(0, 4) };
  if (a.status === 'error' && aaaa.status === 'error') return { state: 'unavailable', error: a.error };
  if (a.status === 'nxdomain' || aaaa.status === 'nxdomain') return { state: 'nxdomain', addresses: [] };
  return { state: 'no_records', addresses: [] };
}

import { classifyEmailDomain } from '../../utils/emailProviders.js';
import { emailDomain, extractWebHosts, normalizeHost, registrableDomain } from '../../utils/domain.js';
import {
  classifyPaymentPurpose, detectGuarantee, detectMessaging, detectPayment, detectSensitive, detectUrgency, parseAuthResults,
} from './signals.js';
import {
  brandForCompany, brandImpersonation, isGenericHost, isOfficialBrandDomain, isShortener, isSuspiciousTld,
  jobThemedDomain, matchCompanyToDomain,
} from './heuristics.js';
import { rdapLookup as realRdap } from './rdap.js';
import { dnsReport as realDns, resolveHost as realResolve } from './dns.js';

export const LEVELS = ['Low', 'Medium', 'High'];
export const levelForScore = (s) => (s >= 50 ? 'High' : s >= 20 ? 'Medium' : 'Low');
const MAX_DOMAINS = 5;

export function formatAge(days) {
  if (days < 1) return 'less than a day';
  if (days < 60) return `${days} day${days === 1 ? '' : 's'}`;
  if (days < 730) return `${Math.round(days / 30)} months`;
  return `${(days / 365).toFixed(1)} years`;
}
const fmtDate = (iso) => (iso ? iso.slice(0, 10) : 'unknown');

/**
 * Run all real verification checks.
 *
 * Groups:
 *  - verified:    facts obtained from an external source (RDAP, DNS, pasted headers) or a deterministic list
 *  - suspicious:  heuristic signals (text patterns, mismatches) — each carries quoted evidence
 *  - unavailable: checks that could not run, with the reason
 *
 * `deps` allows injecting lookup functions (used by the unit tests).
 */
export async function runVerification(extraction, text = '', deps = {}) {
  const { rdapLookup = realRdap, dnsReport = realDns, resolveHost = realResolve, now = Date.now() } = deps;
  const checks = [];
  const push = (c) => checks.push({ points: 0, tone: 'neutral', evidence: [], dedupeKey: null, ...c });

  const company = extraction.companyName || '';
  const brand = brandForCompany(company);
  const body = text || '';

  // ───────── Sender ─────────
  const senderEmail = extraction.senderEmail || null;
  const senderHost = senderEmail ? emailDomain(senderEmail) : null;
  const senderReg = senderHost ? registrableDomain(senderHost) : null;
  const senderClass = senderReg ? classifyEmailDomain(senderReg) : null;

  if (!senderEmail || !senderReg) {
    push({ id: 'sender-missing', group: 'unavailable', title: 'Sender email checks', detail: 'No sender email address was found in the offer, so sender-domain checks could not run. If this is an email, paste the full message including the From line.', source: 'Extraction' });
  } else if (senderClass === 'disposable') {
    push({ id: 'sender-disposable', group: 'verified', tone: 'bad', points: 35, title: 'Sender uses a disposable email service', detail: `${senderEmail} is hosted on ${senderReg}, which is on the built-in list of disposable/temporary mailbox services.`, source: 'Built-in provider list', dedupeKey: 'sender-type' });
  } else if (senderClass === 'free') {
    push({ id: 'sender-free', group: 'verified', tone: 'bad', points: 18, title: 'Sender uses a free email provider', detail: `${senderEmail} is a free consumer mailbox (${senderReg}). Established employers normally write from their own company domain; some small startups do use free mail, so this is a warning, not proof.`, source: 'Built-in provider list', dedupeKey: 'sender-type' });
  } else {
    push({ id: 'sender-corporate', group: 'verified', tone: 'neutral', title: 'Sender uses its own domain', detail: `${senderEmail} is on ${senderReg}, not a free email provider. This says nothing yet about who owns that domain — see the registration checks.`, source: 'Built-in provider list' });
  }

  // ───────── Collect domains to look up ─────────
  const targets = new Map();
  const shorteners = new Set();
  const addTarget = (host, role) => {
    const h = normalizeHost(host);
    const reg = h && registrableDomain(h);
    if (!reg) return;
    if (classifyEmailDomain(reg) !== 'other') return;
    if (role === 'website' || role === 'contact') {
      if (isShortener(reg)) { shorteners.add(h); return; }
      if (role === 'website' && isGenericHost(reg)) return;
    }
    if (!targets.has(reg)) targets.set(reg, { domain: reg, hosts: new Set(), siteHosts: new Set(), roles: new Set() });
    const t = targets.get(reg);
    t.hosts.add(h);
    t.roles.add(role);
    if (role === 'website') t.siteHosts.add(h);
  };

  if (senderHost) addTarget(senderHost, 'sender');
  const replyHost = extraction.replyToEmail ? emailDomain(extraction.replyToEmail) : null;
  const replyReg = replyHost ? registrableDomain(replyHost) : null;
  if (replyHost) addTarget(replyHost, 'reply-to');
  for (const w of extraction.websiteDomains || []) addTarget(w, 'website');
  for (const w of extractWebHosts(body)) addTarget(w, 'website');
  for (const e of extraction.contactEmails || []) { const dh = emailDomain(e); if (dh) addTarget(dh, 'contact'); }

  const allTargets = [...targets.values()];
  const toLookup = allTargets.slice(0, MAX_DOMAINS);
  if (allTargets.length > MAX_DOMAINS) {
    push({ id: 'domains-capped', group: 'unavailable', title: 'Additional domains not looked up', detail: `The offer mentions ${allTargets.length} distinct domains; only the first ${MAX_DOMAINS} (sender first) were checked: ${allTargets.slice(MAX_DOMAINS).map((t) => t.domain).join(', ')}.`, source: 'Verification engine' });
  }

  // ───────── Live lookups (RDAP + DNS) ─────────
  const results = await Promise.all(
    toLookup.map(async (t) => {
      const [rdap, dns] = await Promise.all([rdapLookup(t.domain, { now }), dnsReport(t.domain)]);
      let site = null;
      if (t.siteHosts.size) site = await resolveHost([...t.siteHosts][0]);
      return { domain: t.domain, hosts: [...t.hosts], roles: [...t.roles], rdap, dns, site, siteHost: [...t.siteHosts][0] || null };
    }),
  );

  for (const d of results) {
    const isSender = d.roles.includes('sender');
    const roleText = d.roles.join('/');

    // RDAP registration age
    if (d.rdap.status === 'ok') {
      const age = d.rdap.ageDays;
      const pts = age < 30 ? 35 : age < 90 ? 25 : age < 180 ? 18 : age < 365 ? 8 : 0;
      push({
        id: `rdap-${d.domain}`, group: 'verified', tone: pts > 0 ? 'bad' : 'good', points: pts, subject: d.domain, dedupeKey: 'domain-age',
        title: `${d.domain} was registered ${formatAge(age)} ago`,
        detail: `RDAP shows ${d.domain} (${roleText}) registered on ${fmtDate(d.rdap.registeredAt)}${d.rdap.registrar ? ` via ${d.rdap.registrar}` : ''}${d.rdap.expiresAt ? `, expiring ${fmtDate(d.rdap.expiresAt)}` : ''}.${pts === 0 ? ' An older domain is not proof of legitimacy.' : ' Scam domains are often registered days or weeks before use.'}`,
        source: `RDAP (${d.rdap.source})`,
      });
    } else if (d.rdap.status === 'not_found') {
      push({ id: `rdap-${d.domain}`, group: 'verified', tone: 'bad', points: 30, subject: d.domain, dedupeKey: 'domain-age', title: `${d.domain} has no RDAP registration record`, detail: `The registry's RDAP service answered "not found" for ${d.domain} (${roleText}). That usually means the domain is not registered — though a few registries do not publish RDAP data for every domain.`, source: `RDAP (${d.rdap.source})` });
    } else {
      push({ id: `rdap-${d.domain}`, group: 'unavailable', subject: d.domain, title: `Domain age check for ${d.domain}`, detail: `${d.rdap.error || 'RDAP lookup failed'}. Registration date could not be verified.`, source: 'RDAP' });
    }

    // DNS
    if (d.dns.state === 'unavailable') {
      push({ id: `dns-${d.domain}`, group: 'unavailable', subject: d.domain, title: `DNS check for ${d.domain}`, detail: `DNS lookups failed (${d.dns.error || 'resolver error'}). Records could not be verified.`, source: 'DNS' });
    } else if (d.dns.state === 'nxdomain') {
      push({ id: `dns-${d.domain}`, group: 'verified', tone: 'bad', points: isSender ? 25 : 15, subject: d.domain, dedupeKey: 'dns-missing', title: `${d.domain} does not exist in DNS`, detail: `DNS answered NXDOMAIN for ${d.domain} (${roleText}): no records exist for it.`, source: 'DNS' });
    } else if (d.dns.state === 'no_records') {
      push({ id: `dns-${d.domain}`, group: 'verified', tone: 'bad', points: 10, subject: d.domain, dedupeKey: 'dns-missing', title: `${d.domain} publishes no usable DNS records`, detail: `No address, mail or nameserver records were returned for ${d.domain}.`, source: 'DNS' });
    } else {
      const bits = [];
      if (d.dns.a.length || d.dns.aaaa.length) bits.push(`web address ${[...d.dns.a, ...d.dns.aaaa].slice(0, 2).join(', ')}`);
      if (d.dns.mx.length) bits.push(`mail servers ${d.dns.mx.slice(0, 2).join(', ')}`);
      if (d.dns.ns.length) bits.push(`nameservers ${d.dns.ns.slice(0, 2).join(', ')}`);
      push({ id: `dns-${d.domain}`, group: 'verified', tone: 'good', subject: d.domain, title: `${d.domain} resolves in DNS`, detail: `DNS returned ${bits.join('; ') || 'records'} for ${d.domain}.`, source: 'DNS' });

      if (isSender) {
        if (!d.dns.hasMail) {
          push({ id: `mx-${d.domain}`, group: 'verified', tone: 'bad', points: 20, subject: d.domain, dedupeKey: 'no-mail-server', title: 'Sender domain cannot receive email', detail: `${d.domain} publishes ${d.dns.nullMx ? 'a "null MX" record' : 'no MX records'}, so replies to ${senderEmail} would not be delivered by a normal mail server.`, source: 'DNS' });
        }
        const miss = ['spf', 'dmarc'].filter((k) => d.dns[k] === 'missing');
        const unk = ['spf', 'dmarc'].some((k) => d.dns[k] === 'unknown');
        push({
          id: `mailauth-${d.domain}`, group: unk ? 'unavailable' : 'verified', tone: miss.length ? 'bad' : 'good', points: miss.length === 2 ? 6 : miss.length === 1 ? 3 : 0, subject: d.domain, dedupeKey: 'email-auth',
          title: unk ? `Email-authentication records for ${d.domain}` : miss.length ? `${d.domain} lacks ${miss.map((m) => m.toUpperCase()).join(' and ')}` : `${d.domain} publishes SPF and DMARC`,
          detail: unk ? 'TXT lookups failed, so SPF/DMARC could not be read.' : `SPF record: ${d.dns.spf}. DMARC record: ${d.dns.dmarc}${d.dns.dmarcPolicy ? ` (policy: ${d.dns.dmarcPolicy})` : ''}. This shows how the domain is configured, not whether this specific message was really sent by it.`,
          source: 'DNS',
        });
      }
    }

    if (d.site) {
      if (d.site.state === 'nxdomain') push({ id: `site-${d.domain}`, group: 'verified', tone: 'bad', points: 15, subject: d.domain, dedupeKey: 'dns-missing', title: `Website ${d.siteHost} does not resolve`, detail: `The website host listed in the offer has no DNS address record (NXDOMAIN).`, source: 'DNS' });
      else if (d.site.state === 'resolves') push({ id: `site-${d.domain}`, group: 'verified', tone: 'good', subject: d.domain, title: 'Website host resolves', detail: `${d.siteHost} resolves to ${d.site.addresses.slice(0, 2).join(', ')}. OfferCheck does not open the page.`, source: 'DNS' });
    }
  }

  // ───────── Identity & mismatch heuristics ─────────
  const corporateSender = senderReg && senderClass === 'other';
  const websiteRegs = results.filter((d) => d.roles.includes('website')).map((d) => d.domain);

  if (company && corporateSender) {
    const m = matchCompanyToDomain(company, senderReg);
    if (m.result === 'none') push({ id: 'mismatch-company-sender', group: 'suspicious', tone: 'bad', points: 20, dedupeKey: 'identity-mismatch', title: 'Sender domain does not resemble the company name', detail: `The offer names "${company}" but was sent from ${senderReg}. ${m.detail} (Some real firms use a parent-company domain, so verify independently.)`, source: 'Name-vs-domain heuristic', evidence: [`Company: ${company}`, `Sender domain: ${senderReg}`] });
    else if (m.result === 'lookalike') push({ id: 'lookalike-sender', group: 'suspicious', tone: 'bad', points: 30, dedupeKey: 'impersonation', title: 'Sender domain looks like a misspelling of the company name', detail: `${m.detail} Look-alike domains are a common impersonation trick.`, source: 'Name-vs-domain heuristic', evidence: [`Company: ${company}`, `Sender domain: ${senderReg}`] });
    else if (m.result === 'match') push({ id: 'match-company-sender', group: 'suspicious', tone: 'good', title: 'Sender domain resembles the company name', detail: `${m.detail} (${senderReg} vs "${company}"). A similar-looking name does not prove ownership.`, source: 'Name-vs-domain heuristic' });
  } else if (company && senderClass && senderClass !== 'other' && brand) {
    push({ id: 'mismatch-brand-free', group: 'suspicious', tone: 'bad', points: 15, dedupeKey: 'identity-mismatch', title: `Claims to be ${brand.name} but uses free email`, detail: `The offer names ${brand.name}, yet the sender is on ${senderReg}. Domains for ${brand.name} in the built-in list: ${brand.domains.join(', ')}.`, source: 'Built-in brand list', evidence: [`Company: ${company}`, `Sender: ${senderEmail}`] });
  }

  if (company && websiteRegs.length) {
    const ms = websiteRegs.map((w) => ({ w, m: matchCompanyToDomain(company, w) }));
    if (ms.every((x) => x.m.result === 'none')) push({ id: 'mismatch-company-website', group: 'suspicious', tone: 'bad', points: 15, dedupeKey: 'identity-mismatch', title: 'Website domain does not resemble the company name', detail: `Website domain(s) ${websiteRegs.join(', ')} share no word with "${company}".`, source: 'Name-vs-domain heuristic', evidence: websiteRegs.map((w) => `Website: ${w}`) });
    else if (ms.some((x) => x.m.result === 'lookalike')) { const x = ms.find((y) => y.m.result === 'lookalike'); push({ id: 'lookalike-website', group: 'suspicious', tone: 'bad', points: 30, dedupeKey: 'impersonation', title: 'Website domain looks like a misspelling of the company name', detail: x.m.detail, source: 'Name-vs-domain heuristic', evidence: [`Website: ${x.w}`] }); }
  }

  if (corporateSender && websiteRegs.length && !websiteRegs.includes(senderReg)) {
    push({ id: 'mismatch-sender-website', group: 'suspicious', tone: 'bad', points: 15, dedupeKey: 'identity-mismatch', title: 'Sender domain differs from the website domain', detail: `Email comes from ${senderReg} but the offer points to ${websiteRegs.join(', ')}. Legitimate recruiters normally write from the same domain as the company site.`, source: 'Domain comparison', evidence: [`Sender domain: ${senderReg}`, ...websiteRegs.map((w) => `Website: ${w}`)] });
  }

  if (replyReg && senderReg && replyReg !== senderReg) {
    push({ id: 'reply-to-mismatch', group: 'suspicious', tone: 'bad', points: 15, dedupeKey: 'reply-to', title: 'Reply-To address uses a different domain', detail: `Replies would go to ${extraction.replyToEmail}, not the sender's own domain ${senderReg}. This is a common way to redirect victims.`, source: 'Domain comparison', evidence: [`Reply-To: ${extraction.replyToEmail}`, `Sender: ${senderEmail}`] });
  }

  // Brand impersonation across every host mentioned
  const seenHosts = new Set([...(senderHost ? [senderHost] : []), ...results.flatMap((d) => d.hosts)]);
  for (const h of seenHosts) {
    const b = brandImpersonation(h);
    if (b) push({ id: `brand-${registrableDomain(h)}`, group: 'suspicious', tone: 'bad', points: 30, dedupeKey: 'impersonation', title: `${h} contains "${b.key}" but is not a ${b.name} domain`, detail: `The built-in list of official ${b.name} domains is ${b.domains.join(', ')}. ${h} is not on it — a classic brand-impersonation pattern. (The list is incomplete; verify on the company's real site.)`, source: 'Built-in brand list', evidence: [`Domain: ${h}`] });
  }
  if (brand && senderReg && isOfficialBrandDomain(brand, senderReg)) {
    push({ id: 'brand-official-sender', group: 'verified', tone: 'good', title: `Sender domain is a known ${brand.name} domain`, detail: `${senderReg} is on the built-in list of official ${brand.name} domains. This cannot prove the email was not spoofed; full headers (SPF/DKIM/DMARC) would help.`, source: 'Built-in brand list' });
  }

  for (const d of results) {
    if (isSuspiciousTld(d.domain)) push({ id: `tld-${d.domain}`, group: 'suspicious', tone: 'bad', points: 8, dedupeKey: 'domain-pattern', title: `${d.domain} uses a TLD often seen in abuse`, detail: `The .${d.domain.split('.').pop()} extension is cheap and frequently used in throw-away or scam domains (many legitimate sites use it too).`, source: 'TLD heuristic', evidence: [`Domain: ${d.domain}`] });
    const jt = jobThemedDomain(d.domain);
    if (jt) push({ id: `themed-${d.domain}`, group: 'suspicious', tone: 'bad', points: 6, dedupeKey: 'domain-pattern', title: `${d.domain} is a job-themed domain name`, detail: `The name contains "${jt}" appended to another word — scammers often register names like company-careers.xyz. Real employers also use careers.* subdomains of their main domain.`, source: 'Domain-name heuristic', evidence: [`Domain: ${d.domain}`] });
  }
  if (shorteners.size) push({ id: 'shortener', group: 'suspicious', tone: 'bad', points: 8, dedupeKey: 'shortener', title: 'Link shortener hides the real destination', detail: `The offer uses ${[...shorteners].join(', ')}. The final site cannot be seen without clicking, so it was not checked.`, source: 'Link heuristic', evidence: [...shorteners].map((s) => `Shortener: ${s}`) });

  // ───────── Text signals ─────────
  const llmPayments = extraction.payments || [];
  let paymentCategories = [];
  if (body.trim() || llmPayments.length) {
    const pay = detectPayment(body);
    const paymentEvidence = [
      ...llmPayments.slice(0, 3).map((p) => `Requested: ${[p.amount && `${p.currency || ''}${p.amount}`.trim(), p.purpose, p.method && `via ${p.method}`, p.refundable === true ? '(described as refundable)' : ''].filter(Boolean).join(' ')}${p.quote ? ` — "${p.quote}"` : ''}`),
      ...pay.strong.slice(0, 3).map((m) => `"${m.snippet}"`),
      ...pay.methods.slice(0, 2).map((m) => `"${m.snippet}"`),
    ];
    if (pay.strong.length || llmPayments.length) {
      paymentCategories = [...new Set([...llmPayments.map((p) => classifyPaymentPurpose(p.purpose || '')), ...pay.strong.map((m) => classifyPaymentPurpose(m.phrase))])];
      push({ id: 'payment-request', group: 'suspicious', tone: 'bad', points: 40, dedupeKey: 'payment', title: 'Asks the candidate to pay money', detail: 'Genuine employers do not charge candidates fees, deposits or "refundable" amounts to hire or onboard them. The offer contains a payment request.', source: 'Text pattern analysis + AI extraction', evidence: paymentEvidence });
    } else if (pay.methods.length) {
      push({ id: 'payment-method', group: 'suspicious', tone: 'bad', points: 15, dedupeKey: 'payment', title: 'Mentions a payment channel for the candidate to use', detail: 'The text mentions payment apps or transfer methods alongside words like "pay" or "send". No exact fee was identified.', source: 'Text pattern analysis', evidence: paymentEvidence });
    } else {
      push({ id: 'payment-none', group: 'suspicious', tone: 'good', title: 'No payment request detected', detail: 'No fee, deposit or payment-channel wording was found in the supplied text. Pattern matching can miss things — read the whole offer yourself.', source: 'Text pattern analysis' });
    }

    const urg = detectUrgency(body);
    const deadlines = (extraction.deadlines || []).slice(0, 3).map((x) => `Deadline: ${x.description || ''}${x.date ? ` (${x.date})` : ''}${x.quote ? ` — "${x.quote}"` : ''}`);
    if (urg.matched) push({ id: 'urgency', group: 'suspicious', tone: 'bad', points: urg.matches.length >= 3 ? 14 : 10, dedupeKey: 'urgency', title: 'Pressure or urgency wording', detail: 'The offer pushes a quick response, which reduces your time to verify. Real offers often have deadlines too, so weigh this together with other signals.', source: 'Text pattern analysis', evidence: [...urg.matches.slice(0, 4).map((m) => `"${m.snippet}"`), ...deadlines] });
    else push({ id: 'urgency-none', group: 'suspicious', tone: 'good', title: 'No pressure wording detected', detail: 'No urgency phrases such as "within 24 hours" or "limited seats" were found.', source: 'Text pattern analysis', evidence: deadlines });

    const sens = detectSensitive(body);
    if (sens.credentials.length) push({ id: 'credentials', group: 'suspicious', tone: 'bad', points: 35, dedupeKey: 'credentials', title: 'Mentions OTP, PIN, password or card details', detail: 'No legitimate employer needs your OTP, PIN, password or card number.', source: 'Text pattern analysis', evidence: sens.credentials.slice(0, 3).map((m) => `"${m.snippet}"`) });
    const idItems = [...new Set([...(extraction.requestedSensitiveInfo || []), ...sens.identity.map((m) => m.phrase.toLowerCase())])];
    if (sens.identity.length || (extraction.requestedSensitiveInfo || []).length) push({ id: 'identity-docs', group: 'suspicious', tone: 'bad', points: 12, dedupeKey: 'identity-docs', title: 'Asks for identity or bank details', detail: `Requests mention: ${idItems.slice(0, 5).join(', ')}. Real employers collect these only after you have joined and verified them — share nothing before confirming the employer.`, source: 'Text pattern analysis + AI extraction', evidence: sens.identity.slice(0, 3).map((m) => `"${m.snippet}"`) });
    if (!sens.credentials.length && !sens.identity.length && !(extraction.requestedSensitiveInfo || []).length) push({ id: 'sensitive-none', group: 'suspicious', tone: 'good', title: 'No request for credentials or identity documents detected', detail: 'No mention of OTP/PIN/passwords or Aadhaar/PAN/bank details was found.', source: 'Text pattern analysis' });

    const msg = detectMessaging(body, extraction.messagingHandles || []);
    if (msg.matched || (extraction.messagingHandles || []).length) push({ id: 'messaging', group: 'suspicious', tone: 'bad', points: 8, dedupeKey: 'messaging', title: 'Moves the conversation to WhatsApp or Telegram', detail: 'Recruitment that happens only on messaging apps is harder to trace. Ask for official email or a company number.', source: 'Text pattern analysis + AI extraction', evidence: [...msg.matches.slice(0, 2).map((m) => `"${m.snippet}"`), ...(extraction.messagingHandles || []).slice(0, 2).map((h) => `Handle: ${h}`)] });

    const g = detectGuarantee(body);
    if (g.matched) push({ id: 'guarantee', group: 'suspicious', tone: 'bad', points: 15, dedupeKey: 'guarantee', title: 'Promises selection without a normal hiring process', detail: 'Phrases like "no interview" or "guaranteed placement" are typical of fake offers.', source: 'Text pattern analysis', evidence: g.matches.slice(0, 3).map((m) => `"${m.snippet}"`) });

    const auth = parseAuthResults(body);
    if (auth) {
      const bad = Object.entries(auth).filter(([, v]) => v && ['fail', 'softfail', 'permerror'].includes(v));
      push({ id: 'header-auth', group: 'verified', tone: bad.length ? 'bad' : 'good', points: bad.length ? 25 : 0, dedupeKey: 'header-auth', title: bad.length ? 'Email headers show failed authentication' : 'Email headers show passing authentication', detail: `Authentication-Results in the pasted headers: ${Object.entries(auth).filter(([, v]) => v).map(([k, v]) => `${k.toUpperCase()}=${v}`).join(', ')}.`, source: 'Pasted email headers' });
    } else {
      push({ id: 'header-auth-missing', group: 'unavailable', title: 'Email header authentication (SPF / DKIM / DMARC result)', detail: 'No "Authentication-Results" header was supplied. Paste the full raw email headers (e.g. Gmail → ⋮ → Show original) to enable this check.', source: 'Pasted email headers' });
    }
  } else {
    push({ id: 'text-missing', group: 'unavailable', title: 'Text-pattern checks', detail: 'No readable text was available, so payment, urgency and credential checks could not run.', source: 'Extraction' });
  }

  if ((extraction.phoneNumbers || []).length) push({ id: 'phone-owner', group: 'unavailable', permanent: true, title: 'Phone number ownership', detail: `Found ${extraction.phoneNumbers.slice(0, 3).join(', ')}. No free, reliable public lookup is integrated — call the company using the number on its official website instead.`, source: 'Not part of this version' });
  push({ id: 'company-registry', group: 'unavailable', permanent: true, title: 'Company registration (MCA / GST / registrar)', detail: 'Not checked in this version. You can search the company on the Ministry of Corporate Affairs "company master data" service yourself.', source: 'Not part of this version' });
  push({ id: 'reputation', group: 'unavailable', permanent: true, title: 'Phishing / reputation blocklists', detail: 'Not configured. A service such as Google Safe Browsing (needs its own API key) would be required.', source: 'Not part of this version' });
  push({ id: 'site-content', group: 'unavailable', permanent: true, title: 'Website content comparison', detail: 'OfferCheck never opens or scrapes linked pages, to keep you safe. Type the company\'s official address into your browser yourself.', source: 'By design' });

  // ───────── Scoring ─────────
  const maxByKey = new Map();
  for (const c of checks) if (c.points > 0) {
    const k = c.dedupeKey || c.id;
    maxByKey.set(k, Math.max(maxByKey.get(k) || 0, c.points));
  }
  const used = new Set();
  for (const c of checks) {
    const k = c.dedupeKey || c.id;
    c.counted = c.points > 0 && c.points === maxByKey.get(k) && !used.has(k);
    if (c.counted) used.add(k);
  }
  const score = Math.min(100, [...maxByKey.values()].reduce((a, b) => a + b, 0));
  let ruleRiskLevel = levelForScore(score);
  const hardFloor = checks.some((c) => ['payment-request', 'credentials'].includes(c.id));
  let floorApplied = false;
  if (hardFloor && ruleRiskLevel === 'Low') { ruleRiskLevel = 'Medium'; floorApplied = true; }

  const lookupFailures = results.filter((r) => r.rdap.status === 'unavailable' || r.dns.state === 'unavailable').length;
  let confidence = 'good';
  if ((!senderReg && results.length === 0) || extraction.documentLegibility === 'poor') confidence = 'limited';
  else if (lookupFailures > 0 || !senderReg) confidence = 'partial';

  return {
    checks,
    domains: results.map((d) => ({ domain: d.domain, hosts: d.hosts, roles: d.roles, rdap: d.rdap, dns: d.dns, site: d.site })),
    score,
    ruleRiskLevel,
    floorApplied,
    confidence,
    lookupSummary: {
      domainsChecked: results.length,
      rdapOk: results.filter((r) => r.rdap.status !== 'unavailable').length,
      rdapFailed: results.filter((r) => r.rdap.status === 'unavailable').length,
      dnsOk: results.filter((r) => r.dns.state !== 'unavailable').length,
      dnsFailed: results.filter((r) => r.dns.state === 'unavailable').length,
    },
    counts: {
      verified: checks.filter((c) => c.group === 'verified').length,
      suspicious: checks.filter((c) => c.group === 'suspicious' && c.tone === 'bad').length,
      unavailable: checks.filter((c) => c.group === 'unavailable').length,
    },
    paymentCategories,
  };
}

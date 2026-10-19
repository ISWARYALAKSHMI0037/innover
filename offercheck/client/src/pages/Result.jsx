import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, Check, CheckCircle2, CircleHelp, Copy, ExternalLink, Info, Printer, Trash2 } from 'lucide-react';
import { api } from '../api.js';
import { Banner, PageLoading, copyText, fmtDate, fmtDateTime, useDocTitle, useToast } from '../ui.jsx';
import { ProgressList } from './Analyze.jsx';

const GROUPS = [
  { key: 'verified', title: 'Verified facts', blurb: 'Looked up from an outside source (RDAP, DNS, pasted headers) or a fixed list.' },
  { key: 'suspicious', title: 'Suspicious signals', blurb: 'Heuristics on the text and names. Each quotes what it found. Green items mean the signal was not triggered.' },
  { key: 'unavailable', title: 'Unavailable checks', blurb: 'These did not run. Nothing is assumed about them.' },
];

function toneIcon(c) {
  if (c.group === 'unavailable') return <CircleHelp size={18} aria-hidden />;
  if (c.tone === 'bad') return <AlertTriangle size={18} aria-hidden />;
  if (c.tone === 'good') return <CheckCircle2 size={18} aria-hidden />;
  return <Info size={18} aria-hidden />;
}

function CheckCard({ c }) {
  return (
    <li id={`ev-${c.id}`} className={`check-card tone-${c.group === 'unavailable' ? 'na' : c.tone}`}>
      <span className="check-icon">{toneIcon(c)}</span>
      <div>
        <h4>{c.title}</h4>
        <p>{c.detail}</p>
        {c.evidence?.length > 0 && <ul className="quotes">{c.evidence.map((e, i) => <li key={i}>{e}</li>)}</ul>}
        <p className="check-meta">
          <span className="chip">{c.source}</span>
          {c.points > 0 && (c.counted ? <span className="chip chip-bad">+{c.points} risk points</span> : <span className="chip" title="Another signal of the same kind already counted">overlaps · not double-counted</span>)}
        </p>
      </div>
    </li>
  );
}

function DomainCard({ d }) {
  const r = d.rdap || {}, n = d.dns || {};
  const yn = (v) => (v === 'present' ? 'Present' : v === 'missing' ? 'Missing' : 'Unknown');
  return (
    <article className="panel domain-card">
      <header>
        <h4 className="mono">{d.domain}</h4>
        <div>{d.roles.map((x) => <span className="chip" key={x}>{x}</span>)}</div>
      </header>
      <dl className="kv">
        <dt>Registered</dt>
        <dd>{r.status === 'ok' ? `${fmtDate(r.registeredAt)} (${r.ageDays} days ago)` : r.status === 'not_found' ? 'No RDAP record found' : <span className="na">Unavailable — {r.error}</span>}</dd>
        {r.status === 'ok' && <><dt>Registrar</dt><dd>{r.registrar || 'Not published'}</dd><dt>Expires</dt><dd>{fmtDate(r.expiresAt)}</dd></>}
        <dt>DNS</dt>
        <dd>{{ resolves: 'Resolves', nxdomain: 'Does not exist (NXDOMAIN)', no_records: 'No usable records', unavailable: 'Unavailable' }[n.state] || '—'}{n.state === 'unavailable' && n.error ? ` — ${n.error}` : ''}</dd>
        {n.state === 'resolves' && <>
          <dt>Mail servers</dt><dd className="mono">{n.mx?.length ? n.mx.join(', ') : 'None published'}</dd>
          <dt>Nameservers</dt><dd className="mono">{n.ns?.join(', ') || '—'}</dd>
          {d.roles.includes('sender') && <><dt>SPF / DMARC</dt><dd>{yn(n.spf)} / {yn(n.dmarc)}{n.dmarcPolicy ? ` (p=${n.dmarcPolicy})` : ''}</dd></>}
        </>}
        <dt>Source</dt><dd className="small muted">RDAP: {r.source || '—'} · DNS: system resolver</dd>
      </dl>
    </article>
  );
}

function Field({ label, children }) {
  if (children === null || children === undefined || children === '' || (Array.isArray(children) && !children.length)) return null;
  return <><dt>{label}</dt><dd>{children}</dd></>;
}

function buildSummaryText(a) {
  const r = a.report || {};
  const ex = a.extraction || {};
  return [
    `OfferCheck result: ${r.riskLevel} risk (rule-based score ${a.verification?.score}/100)`,
    ex.companyName ? `Company: ${ex.companyName}` : null,
    ex.senderEmail ? `Sender: ${ex.senderEmail}` : null,
    '', r.headline, r.summary, '',
    'Reasons:', ...(r.reasons || []).map((x) => `- ${x.text}`), '',
    'Next steps:', ...(r.nextSteps || []).map((x) => `- ${x}`), '', r.disclaimer,
  ].filter((x) => x !== null).join('\n');
}

export default function Result() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [a, setA] = useState(null);
  const [error, setError] = useState('');
  const [confirmDel, setConfirmDel] = useState(false);
  const [done, setDone] = useState({});
  useDocTitle(a?.companyName ? `${a.companyName} — ${a.riskLevel || 'result'}` : 'Result');

  const stepsKey = `oc_steps_${id}`;
  useEffect(() => { try { setDone(JSON.parse(localStorage.getItem(stepsKey) || '{}')); } catch { setDone({}); } }, [stepsKey]);

  useEffect(() => {
    let stop = false, timer;
    const load = async () => {
      try {
        const d = await api.getAnalysis(id);
        if (stop) return;
        setA(d); setError('');
        if (d.status === 'processing') timer = setTimeout(load, 1500);
      } catch (e) { if (!stop) setError(e.message); }
    };
    load();
    return () => { stop = true; clearTimeout(timer); };
  }, [id]);

  const grouped = useMemo(() => {
    const checks = a?.verification?.checks || [];
    const order = (c) => (c.tone === 'bad' ? 0 : c.tone === 'neutral' ? 1 : 2);
    return Object.fromEntries(GROUPS.map((g) => [g.key, checks.filter((c) => c.group === g.key).sort((x, y) => order(x) - order(y) || (y.points || 0) - (x.points || 0))]));
  }, [a]);

  const jump = useCallback((cid) => {
    const el = document.getElementById(`ev-${cid}`);
    if (!el) return;
    el.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 1600);
  }, []);

  const toggleStep = (i) => setDone((d) => { const n = { ...d, [i]: !d[i] }; try { localStorage.setItem(stepsKey, JSON.stringify(n)); } catch { /* ignore */ } return n; });

  async function onCopy() { toast((await copyText(buildSummaryText(a))) ? 'Summary copied to clipboard' : 'Could not copy. Select the text manually.', 'info'); }
  async function onDelete() {
    try { await api.deleteAnalysis(id); toast('Analysis deleted'); navigate('/history'); } catch (e) { toast(e.message, 'error'); setConfirmDel(false); }
  }

  if (error && !a) return <div className="container page narrow"><Banner tone="error" title="Could not load this analysis" action={<Link className="btn btn-ghost btn-sm" to="/history">My history</Link>}>{error}</Banner></div>;
  if (!a) return <PageLoading label="Loading analysis…" />;

  if (a.status === 'processing') return (
    <div className="container page narrow"><section className="panel progress-panel"><h1 className="page-title sm">Analysing your offer</h1><ProgressList steps={a.progress} /></section></div>
  );
  if (a.status === 'failed') return (
    <div className="container page narrow">
      <Banner tone="error" title="This analysis failed" action={<Link className="btn btn-primary btn-sm" to="/analyze">Try again</Link>}>{a.errorMessage}</Banner>
      <ProgressList steps={a.progress} />
      <button className="btn btn-ghost" onClick={onDelete}><Trash2 size={16} aria-hidden /> Delete this record</button>
    </div>
  );

  const r = a.report || {}, v = a.verification || {}, ex = a.extraction || {};
  const lang = r.language === 'ta' ? 'ta' : undefined;
  const lvl = (r.riskLevel || 'Low').toLowerCase();
  const sourceNote = { ai: { 'ai-agrees': 'The AI agreed with the rule-based level.', 'ai-adjusted': `The AI adjusted the rule-based level (${r.ruleRiskLevel}) by one step.`, 'ai-clamped': `The AI suggested a different level, but it is limited to one step from the rule-based level (${r.ruleRiskLevel}).`, 'rules-floor': 'A payment or credential request sets a minimum of Medium risk.' }[r.riskLevelSource], 'rules-fallback': 'Level comes from the rule-based checks only.' }[r.generatedBy === 'ai' ? 'ai' : 'rules-fallback'];

  return (
    <div className="container page result">
      {a.isSample && <Banner tone="warn" title="Sample record">This is invented demonstration data, not a real verification.</Banner>}

      <header className="result-head">
        <div className={`stamp stamp-${lvl}`} role="img" aria-label={`${r.riskLevel} risk, score ${v.score} out of 100`}>
          <span className="stamp-level">{r.riskLevel} risk</span>
          <span className="stamp-score">{v.score}<small>/100</small></span>
          <span className="stamp-label">rule-based score</span>
        </div>
        <div className="result-title">
          <h1>{ex.companyName || 'Company not identified'}</h1>
          <p className="muted">{[ex.jobTitle, ex.offerType !== 'unknown' && ex.offerType, ex.senderEmail].filter(Boolean).join(' · ') || 'Details not found in the offer'}</p>
          <p className="small muted">Checked {fmtDateTime(a.createdAt)} · source: {a.source?.type}{a.source?.fileName ? ` (${a.source.fileName})` : ''}</p>
          <div className="actions no-print">
            <button className="btn btn-ghost btn-sm" onClick={() => window.print()}><Printer size={16} aria-hidden /> Print or save as PDF</button>
            <button className="btn btn-ghost btn-sm" onClick={onCopy}><Copy size={16} aria-hidden /> Copy summary</button>
            {!confirmDel ? <button className="btn btn-ghost btn-sm" onClick={() => setConfirmDel(true)}><Trash2 size={16} aria-hidden /> Delete</button> : (
              <span className="confirm" role="alertdialog" aria-label="Confirm deletion"><span>Delete permanently?</span><button className="btn btn-danger btn-sm" onClick={onDelete}>Yes, delete</button><button className="btn btn-ghost btn-sm" onClick={() => setConfirmDel(false)}>Cancel</button></span>
            )}
            <Link className="btn btn-primary btn-sm" to="/analyze">Check another</Link>
          </div>
        </div>
      </header>

      {v.confidence !== 'good' && (
        <Banner tone="warn" title={v.confidence === 'limited' ? 'Limited evidence' : 'Some checks could not run'}>
          {v.confidence === 'limited' ? 'There was little to verify (for example no sender email or website). A low result here means little, not safety.' : 'See “Unavailable checks” below. A missing check is never counted as a pass.'}
        </Banner>
      )}

      <section className="panel report" aria-labelledby="report-h" lang={lang}>
        <div className="report-top">
          <h2 id="report-h">{r.headline}</h2>
          <span className={`chip ${r.generatedBy === 'ai' ? 'chip-ai' : ''}`}>{r.generatedBy === 'ai' ? `AI explanation · ${r.model}` : 'Rule-based summary'}</span>
        </div>
        <p className="report-summary">{r.summary}</p>
        {r.generatedBy !== 'ai' && <p className="small muted" lang="en">AI explanation unavailable: {r.llmError}. {r.languageNote}</p>}
        <p className="small muted" lang="en">{sourceNote} The AI only sees the evidence listed below; statements it could not tie to that evidence were removed{r.groundingRemoved ? ` (${r.groundingRemoved} removed here)` : ''}.</p>

        <div className="report-cols">
          <div>
            <h3>Why this level</h3>
            <ul className="reasons">
              {(r.reasons || []).map((x, i) => (
                <li key={i}>
                  <p>{x.text}</p>
                  {x.evidenceIds?.length > 0 && <p className="no-print">{x.evidenceIds.map((e) => <button key={e} className="chip chip-btn" onClick={() => jump(e)} aria-label={`Show evidence ${e}`}>See evidence</button>)}</p>}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3>What to do next</h3>
            <ul className="todo">
              {(r.nextSteps || []).map((s, i) => (
                <li key={i}><label><input type="checkbox" checked={!!done[i]} onChange={() => toggleStep(i)} /><span>{s}</span></label></li>
              ))}
            </ul>
            <p className="small"><a href="https://cybercrime.gov.in" target="_blank" rel="noopener noreferrer">cybercrime.gov.in <ExternalLink size={13} aria-hidden /></a> · helpline 1930 (India)</p>
          </div>
        </div>
        <p className="disclaimer"><Info size={16} aria-hidden /> <span>{r.disclaimer}</span></p>
      </section>

      <section aria-labelledby="ev-h" className="evidence">
        <h2 id="ev-h">Evidence</h2>
        <div className="evidence-grid">
          {GROUPS.map((g) => (
            <div key={g.key} className={`ev-col group-${g.key}`}>
              <h3>{g.title} <span className="count">{grouped[g.key].length}</span></h3>
              <p className="small muted">{g.blurb}</p>
              {grouped[g.key].length ? <ul className="check-list">{grouped[g.key].map((c) => <CheckCard key={c.id} c={c} />)}</ul> : <p className="muted small">Nothing in this group.</p>}
            </div>
          ))}
        </div>
      </section>

      {v.domains?.length > 0 && (
        <section aria-labelledby="dom-h">
          <h2 id="dom-h">Domain look-ups</h2>
          <div className="domain-grid">{v.domains.map((d) => <DomainCard key={d.domain} d={d} />)}</div>
        </section>
      )}

      <section aria-labelledby="ext-h" className="panel">
        <h2 id="ext-h">What the AI read from the offer</h2>
        <dl className="kv wide">
          <Field label="Company">{ex.companyName}</Field>
          <Field label="Role">{ex.jobTitle}</Field>
          <Field label="Sender">{[ex.senderName, ex.senderEmail].filter(Boolean).join(' · ')}</Field>
          <Field label="Reply-To">{ex.replyToEmail}</Field>
          <Field label="Other emails">{ex.contactEmails?.filter((e) => e !== ex.senderEmail).join(', ')}</Field>
          <Field label="Phone numbers">{ex.phoneNumbers?.join(', ')}</Field>
          <Field label="Websites">{ex.websiteDomains?.join(', ')}</Field>
          <Field label="Messaging handles">{ex.messagingHandles?.join(', ')}</Field>
          <Field label="Stipend or salary">{ex.salaryOrStipend}</Field>
          <Field label="Requested payments">{ex.payments?.length ? <ul className="plain">{ex.payments.map((p, i) => <li key={i}>{[p.currency, p.amount].filter(Boolean).join(' ')} {p.purpose && `· ${p.purpose}`} {p.method && `· via ${p.method}`} {p.refundable && '· “refundable”'}</li>)}</ul> : null}</Field>
          <Field label="Deadlines">{ex.deadlines?.length ? <ul className="plain">{ex.deadlines.map((d, i) => <li key={i}>{d.description} {d.date && `(${d.date})`}</li>)}</ul> : null}</Field>
          <Field label="Sensitive info requested">{ex.requestedSensitiveInfo?.join(', ')}</Field>
        </dl>
        {a.droppedUngrounded?.length > 0 && <p className="small muted">Discarded because they were not found in your text: <span className="mono">{a.droppedUngrounded.join(', ')}</span></p>}
        {a.source?.textOrigin === 'llm-transcription' && <p className="small muted">Text checks ran on the AI’s transcription of your image/PDF, which may contain reading errors.</p>}
        <details className="raw">
          <summary>Show the text that was checked</summary>
          <pre>{a.rawText || 'No text available.'}</pre>
        </details>
        <p className="small muted">Analysis steps: {(a.progress || []).map((s) => `${s.label} — ${s.status}`).join(' · ')}</p>
      </section>
    </div>
  );
}

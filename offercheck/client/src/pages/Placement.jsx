import { useCallback, useEffect, useState } from 'react';
import { Download, Lock, Megaphone, RefreshCw, TrendingDown, TrendingUp, Trash2, Users } from 'lucide-react';
import { api, passcodeStore } from '../api.js';
import { BarList, WeeklyChart } from '../components/Charts.jsx';
import { Banner, EmptyState, PageLoading, copyText, fmtDate, useDocTitle, useToast } from '../ui.jsx';

function Gate({ onUnlock, error, busy }) {
  const [v, setV] = useState('');
  return (
    <div className="container page narrow">
      <form className="panel gate" onSubmit={(e) => { e.preventDefault(); onUnlock(v); }}>
        <Lock size={28} aria-hidden />
        <h1 className="page-title sm">Placement-cell dashboard</h1>
        <p className="muted">Enter the passcode set by your administrator (PLACEMENT_CELL_PASSCODE).</p>
        <label htmlFor="pc" className="label">Passcode</label>
        <input id="pc" type="password" value={v} onChange={(e) => setV(e.target.value)} autoComplete="current-password" required />
        {error && <p className="field-error" role="alert">{error}</p>}
        <button className="btn btn-primary" disabled={busy || !v}>{busy ? 'Checking…' : 'Open dashboard'}</button>
      </form>
    </div>
  );
}

const toCsv = (rows) => rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');

export default function Placement() {
  useDocTitle('Placement cell');
  const toast = useToast();
  const [meta, setMeta] = useState(null);
  const [needsPass, setNeedsPass] = useState(false);
  const [gateError, setGateError] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [dataset, setDataset] = useState('real');
  const [college, setCollege] = useState('');
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);

  const loadMeta = useCallback(async () => {
    try {
      const m = await api.placementMeta();
      setMeta(m); setNeedsPass(false); setError('');
      return m;
    } catch (e) {
      if (e.code === 'bad_passcode') { setNeedsPass(true); passcodeStore.clear(); } else setError(e.message);
      setLoading(false);
      return null;
    }
  }, []);

  useEffect(() => { loadMeta(); }, [loadMeta]);

  const loadStats = useCallback(async () => {
    setLoading(true);
    try { setStats(await api.placementStats({ dataset, college })); setError(''); }
    catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [dataset, college]);

  useEffect(() => { if (meta) loadStats(); }, [meta, loadStats]);

  async function unlock(pass) {
    setBusy(true); setGateError('');
    passcodeStore.set(pass);
    try { const m = await api.placementMeta(); setMeta(m); setNeedsPass(false); }
    catch (e) { setGateError(e.code === 'bad_passcode' ? 'That passcode is not correct.' : e.message); passcodeStore.clear(); }
    finally { setBusy(false); }
  }

  async function seed() {
    setWorking(true);
    try { const r = await api.seedSample(); toast(`Created ${r.created} sample records`); setDataset('sample'); setCollege(''); await loadMeta(); await loadStats(); }
    catch (e) { toast(e.message, 'error'); } finally { setWorking(false); }
  }
  async function unseed() {
    setWorking(true);
    try { const r = await api.removeSample(); toast(`Removed ${r.removed} sample records`); setDataset('real'); setCollege(''); await loadMeta(); }
    catch (e) { toast(e.message, 'error'); } finally { setWorking(false); }
  }

  const advisory = () => {
    if (!stats?.totals.total) return '';
    const t = stats.totals;
    const sig = stats.topSignals.slice(0, 3).map((s) => s.label.toLowerCase()).join('; ');
    const doms = stats.flaggedDomains.slice(0, 5).map((d) => d.domain).join(', ');
    return [
      `Placement cell advisory${stats.college ? ` — ${stats.college}` : ''}`,
      `${t.total} offers were checked with OfferCheck; ${t.highPct}% were high risk and ${t.paymentPct}% asked the candidate to pay money.`,
      sig ? `Most common warning signs: ${sig}.` : '',
      doms ? `Sender domains flagged in high-risk offers: ${doms}.` : '',
      'Reminder: genuine employers never charge candidates. Do not pay any fee or share Aadhaar/PAN/bank details until the employer is confirmed through its official website. Show any doubtful offer to the placement cell before replying.',
      'Report fraud at cybercrime.gov.in or call 1930.',
    ].filter(Boolean).join('\n\n');
  };

  const exportCsv = () => {
    const rows = [['domain', 'high_risk_offers', 'domain_age_days', 'last_seen'], ...stats.flaggedDomains.map((d) => [d.domain, d.count, d.ageDays ?? '', d.lastSeen])];
    const blob = new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `offercheck-flagged-domains-${dataset}.csv`; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('CSV downloaded');
  };

  if (needsPass) return <Gate onUnlock={unlock} error={gateError} busy={busy} />;
  if (!meta && loading) return <PageLoading label="Opening dashboard…" />;
  if (!meta) return <div className="container page narrow"><Banner tone="error" title="Dashboard unavailable" action={<button className="btn btn-ghost btn-sm" onClick={loadMeta}>Retry</button>}>{error}</Banner></div>;

  const t = stats?.totals;
  const colleges = meta.colleges[dataset] || [];
  const delta = t ? t.last7 - t.prev7 : 0;

  return (
    <div className="container page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Placement-cell dashboard</h1>
          <p className="muted">Anonymous totals from students who chose to share. No names, files or message text are shown.</p>
        </div>
        <div className="head-actions">
          <button className="btn btn-ghost btn-sm" onClick={loadStats} disabled={loading}><RefreshCw size={16} aria-hidden /> Refresh</button>
        </div>
      </div>

      {!meta.passcodeRequired && <Banner tone="warn" title="No passcode set">Anyone who can reach this server can open this page. Set PLACEMENT_CELL_PASSCODE in server/.env before deploying.</Banner>}

      <div className="toolbar">
        <div className="seg" role="group" aria-label="Data source">
          <button type="button" aria-pressed={dataset === 'real'} className={dataset === 'real' ? 'on' : ''} onClick={() => { setDataset('real'); setCollege(''); }}>Real checks ({meta.counts.real})</button>
          <button type="button" aria-pressed={dataset === 'sample'} className={dataset === 'sample' ? 'on' : ''} onClick={() => { setDataset('sample'); setCollege(''); }}>Sample data ({meta.counts.sample})</button>
        </div>
        <div className="select-wrap">
          <label htmlFor="col" className="sr-only">College</label>
          <select id="col" value={college} onChange={(e) => setCollege(e.target.value)}>
            <option value="">All colleges</option>
            {colleges.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        {meta.demoSeedAllowed && (
          <div className="head-actions">
            <button className="btn btn-ghost btn-sm" disabled={working} onClick={seed}>{meta.counts.sample ? 'Regenerate sample data' : 'Load sample data'}</button>
            {meta.counts.sample > 0 && <button className="btn btn-ghost btn-sm" disabled={working} onClick={unseed}><Trash2 size={15} aria-hidden /> Remove sample data</button>}
          </div>
        )}
      </div>

      {dataset === 'sample' && <Banner tone="warn" title="Sample data">Everything below is invented for demonstration. It is not real verification of any offer.</Banner>}
      {error && <Banner tone="error" title="Could not load statistics">{error}</Banner>}

      {loading && !stats ? <PageLoading label="Loading statistics…" /> : stats && !t.total ? (
        <EmptyState icon={Users} title={dataset === 'real' ? 'No shared checks yet' : 'No sample data loaded'}
          action={dataset === 'sample' && meta.demoSeedAllowed ? <button className="btn btn-primary" onClick={seed} disabled={working}>Load sample data</button> : undefined}>
          {dataset === 'real' ? 'Statistics appear here once students run checks with campus sharing on. To preview the layout, switch to Sample data.' : 'Load sample data to preview this dashboard.'}
        </EmptyState>
      ) : stats && (
        <>
          <div className="kpis">
            <div className="kpi"><span className="kpi-n">{t.total}</span><span>offers checked</span><span className="kpi-sub">{delta === 0 ? 'same as previous 7 days' : <>{delta > 0 ? <TrendingUp size={14} aria-hidden /> : <TrendingDown size={14} aria-hidden />} {Math.abs(delta)} {delta > 0 ? 'more' : 'fewer'} than previous 7 days</>}</span></div>
            <div className="kpi kpi-high"><span className="kpi-n">{t.highPct}%</span><span>high risk</span><span className="kpi-sub">{t.high} offers</span></div>
            <div className="kpi kpi-medium"><span className="kpi-n">{t.paymentPct}%</span><span>asked for payment</span><span className="kpi-sub">fees, deposits, kits</span></div>
            <div className="kpi"><span className="kpi-n">{t.freeEmailPct}%</span><span>from free email</span><span className="kpi-sub">average score {t.avgScore}/100</span></div>
          </div>

          <div className="dash-grid">
            <section className="panel span-2"><h2>Offers checked per week</h2><WeeklyChart trend={stats.trend} /></section>
            <section className="panel"><h2>Most common warning signs</h2><BarList items={stats.topSignals} total={t.total} color="var(--warn)" /></section>
            <section className="panel"><h2>What scammers ask money for</h2><BarList items={stats.paymentCategories} color="var(--bad)" emptyText="No payment requests recorded." /></section>
            <section className="panel"><h2>Age of sender domains</h2><p className="small muted">From RDAP. Very new domains are a common scam sign.</p><BarList items={stats.domainAgeBuckets} color="var(--accent)" /></section>
            <section className="panel">
              <div className="panel-head"><h2>Sender domains in high-risk offers</h2>
                {stats.flaggedDomains.length > 0 && <button className="btn btn-ghost btn-sm" onClick={exportCsv}><Download size={15} aria-hidden /> CSV</button>}</div>
              {stats.flaggedDomains.length ? (
                <div className="table-wrap"><table className="table">
                  <thead><tr><th scope="col">Domain</th><th scope="col">Offers</th><th scope="col">Age</th><th scope="col">Last seen</th></tr></thead>
                  <tbody>{stats.flaggedDomains.map((d) => <tr key={d.domain}><td className="mono">{d.domain}</td><td>{d.count}</td><td>{d.ageDays != null ? `${d.ageDays} d` : '—'}</td><td>{fmtDate(d.lastSeen)}</td></tr>)}</tbody>
                </table></div>
              ) : <p className="muted small">No high-risk sender domains yet (free-email senders are not listed).</p>}
            </section>
            <section className="panel span-2 advisory">
              <div className="panel-head"><h2><Megaphone size={18} aria-hidden /> Student advisory</h2>
                <button className="btn btn-primary btn-sm" onClick={async () => toast((await copyText(advisory())) ? 'Advisory copied. Paste it into your notice board or WhatsApp group.' : 'Could not copy', 'info')}>Copy advisory</button></div>
              <pre className="advisory-text">{advisory()}</pre>
              {dataset === 'sample' && <p className="small muted">Generated from sample data. Do not circulate.</p>}
            </section>
          </div>
        </>
      )}
    </div>
  );
}

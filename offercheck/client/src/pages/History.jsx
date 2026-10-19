import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, FileText, History as HistoryIcon, Image as ImageIcon, Loader2, Search, Trash2 } from 'lucide-react';
import { api } from '../api.js';
import { Banner, EmptyState, PageLoading, RiskBadge, SampleBadge, timeAgo, useDocTitle, useToast } from '../ui.jsx';

const FILTERS = ['All', 'High', 'Medium', 'Low'];

export default function History() {
  useDocTitle('My history');
  const toast = useToast();
  const [risk, setRisk] = useState('All');
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [page, setPage] = useState(1);
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [error, setError] = useState('');
  const [confirmId, setConfirmId] = useState(null);

  useEffect(() => { const t = setTimeout(() => { setDebouncedQ(q); setPage(1); }, 300); return () => clearTimeout(t); }, [q]);

  const loadStats = useCallback(() => api.myStats().then(setStats).catch(() => setStats(null)), []);
  useEffect(() => { loadStats(); }, [loadStats]);

  useEffect(() => {
    const ac = new AbortController();
    (page === 1 ? setLoading : setMore)(true);
    api.listAnalyses({ risk: risk === 'All' ? undefined : risk, q: debouncedQ, page, pageSize: 12 }, ac.signal)
      .then((d) => { setItems((prev) => (page === 1 ? d.items : [...prev, ...d.items])); setTotal(d.total); setError(''); })
      .catch((e) => { if (e.name !== 'AbortError') setError(e.message); })
      .finally(() => { setLoading(false); setMore(false); });
    return () => ac.abort();
  }, [risk, debouncedQ, page]);

  const changeRisk = (r) => { setRisk(r); setPage(1); };

  async function del(id) {
    try {
      await api.deleteAnalysis(id);
      setItems((x) => x.filter((i) => i.id !== id)); setTotal((t) => t - 1); setConfirmId(null);
      toast('Analysis deleted'); loadStats();
    } catch (e) { toast(e.message, 'error'); }
  }

  const filtered = risk !== 'All' || debouncedQ;

  return (
    <div className="container page">
      <div className="page-head">
        <div><h1 className="page-title">My history</h1><p className="muted">Offers you checked in this browser. Only you can open them.</p></div>
        <Link className="btn btn-primary" to="/analyze">New check</Link>
      </div>

      {stats && (
        <div className="kpis" aria-label="Your totals">
          <div className="kpi"><span className="kpi-n">{stats.total}</span><span>checked</span></div>
          <div className="kpi kpi-high"><span className="kpi-n">{stats.high}</span><span>high risk</span></div>
          <div className="kpi kpi-medium"><span className="kpi-n">{stats.medium}</span><span>medium risk</span></div>
          <div className="kpi kpi-low"><span className="kpi-n">{stats.low}</span><span>low risk</span></div>
        </div>
      )}

      <div className="toolbar">
        <div className="seg" role="group" aria-label="Filter by risk level">
          {FILTERS.map((f) => <button key={f} type="button" aria-pressed={risk === f} className={risk === f ? 'on' : ''} onClick={() => changeRisk(f)}>{f}</button>)}
        </div>
        <div className="search">
          <Search size={16} aria-hidden />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search company, role or sender" aria-label="Search history" maxLength={60} />
        </div>
      </div>

      {error && <Banner tone="error" title="Could not load your history">{error}</Banner>}
      {loading ? <PageLoading label="Loading history…" /> : !items.length && !error ? (
        <EmptyState icon={HistoryIcon} title={filtered ? 'No matches' : 'No checks yet'} action={!filtered && <Link className="btn btn-primary" to="/analyze">Check your first offer</Link>}>
          {filtered ? 'Try a different filter or search term.' : 'Offers you check will be listed here with their full reports.'}
        </EmptyState>
      ) : (
        <>
          <ul className="history-list">
            {items.map((i) => (
              <li key={i.id} className={`hist hist-${(i.riskLevel || 'na').toLowerCase()}`}>
                <Link to={`/analysis/${i.id}`} className="hist-main">
                  <span className="hist-icon">{i.sourceType === 'image' ? <ImageIcon size={20} aria-hidden /> : <FileText size={20} aria-hidden />}</span>
                  <span className="hist-text">
                    <strong>{i.companyName || (i.status === 'failed' ? 'Failed analysis' : i.status === 'processing' ? 'In progress…' : 'Company not identified')}</strong>
                    <span className="muted small">{[i.jobTitle, i.senderEmail, i.fileName].filter(Boolean).join(' · ') || `${i.sourceType || ''} offer`}</span>
                    {i.status === 'failed' && <span className="small bad-text"><AlertTriangle size={13} aria-hidden /> {i.errorMessage}</span>}
                  </span>
                  <span className="hist-meta">
                    {i.status === 'complete' ? <RiskBadge level={i.riskLevel} /> : <span className={`badge ${i.status === 'failed' ? 'badge-high' : 'badge-na'}`}>{i.status === 'failed' ? 'Failed' : 'Processing'}</span>}
                    {i.isSample && <SampleBadge />}
                    <span className="small muted">{i.status === 'complete' ? `${i.signalCount} signal${i.signalCount === 1 ? '' : 's'} · ` : ''}{timeAgo(i.createdAt)}</span>
                  </span>
                </Link>
                <div className="hist-actions">
                  {confirmId === i.id ? (
                    <span className="confirm"><button className="btn btn-danger btn-sm" onClick={() => del(i.id)}>Delete</button><button className="btn btn-ghost btn-sm" onClick={() => setConfirmId(null)}>Keep</button></span>
                  ) : <button className="icon-btn" onClick={() => setConfirmId(i.id)} aria-label={`Delete analysis of ${i.companyName || 'offer'}`}><Trash2 size={18} /></button>}
                </div>
              </li>
            ))}
          </ul>
          {items.length < total && (
            <div className="center"><button className="btn btn-ghost" disabled={more} onClick={() => setPage((p) => p + 1)}>{more ? <><Loader2 className="spin" size={16} aria-hidden /> Loading…</> : `Load more (${total - items.length} left)`}</button></div>
          )}
        </>
      )}
    </div>
  );
}

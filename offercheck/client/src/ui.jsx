import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, CircleHelp, Info, Loader2, ShieldAlert, ShieldCheck, ShieldX, X } from 'lucide-react';

/* ───────── document title ───────── */
export function useDocTitle(title) {
  useEffect(() => {
    document.title = title ? `${title} · OfferCheck` : 'OfferCheck — Fake job & internship offer verifier';
  }, [title]);
}

/* ───────── toasts ───────── */
const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const idRef = useRef(0);
  const toast = useCallback((message, type = 'info') => {
    const id = ++idRef.current;
    setItems((x) => [...x, { id, message, type }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), 4500);
  }, []);
  return (
    <ToastCtx.Provider value={toast}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast toast-${t.type}`}>
            {t.type === 'error' ? <AlertTriangle size={18} aria-hidden /> : <CheckCircle2 size={18} aria-hidden />}
            <span>{t.message}</span>
            <button className="icon-btn" aria-label="Dismiss notification" onClick={() => setItems((x) => x.filter((y) => y.id !== t.id))}><X size={16} /></button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/* ───────── small pieces ───────── */
export function Spinner({ label = 'Loading' }) {
  return <span className="spinner" role="status" aria-label={label}><Loader2 size={20} aria-hidden /></span>;
}

export function PageLoading({ label = 'Loading…' }) {
  return <div className="page-loading" role="status"><Loader2 className="spin" size={22} aria-hidden /><span>{label}</span></div>;
}

export function Banner({ tone = 'info', title, children, action }) {
  const Icon = tone === 'error' ? ShieldX : tone === 'warn' ? AlertTriangle : Info;
  return (
    <div className={`banner banner-${tone}`} role={tone === 'error' ? 'alert' : 'note'}>
      <Icon size={20} aria-hidden />
      <div>
        {title && <strong>{title}</strong>}
        <div>{children}</div>
      </div>
      {action}
    </div>
  );
}

export function EmptyState({ icon: Icon = CircleHelp, title, children, action }) {
  return (
    <div className="empty">
      <Icon size={30} aria-hidden />
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

const LEVEL_ICON = { Low: ShieldCheck, Medium: ShieldAlert, High: ShieldX };
export function RiskBadge({ level, size = 'md' }) {
  if (!level) return <span className="badge badge-na">Pending</span>;
  const Icon = LEVEL_ICON[level];
  return (
    <span className={`badge badge-${level.toLowerCase()} badge-${size}`}>
      <Icon size={size === 'lg' ? 18 : 14} aria-hidden />
      {level} risk
    </span>
  );
}

export function SampleBadge() {
  return <span className="badge badge-sample" title="Invented demonstration data, not a real verification">Sample</span>;
}

/* ───────── helpers ───────── */
export function timeAgo(iso) {
  const s = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} day${d > 1 ? 's' : ''} ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export const fmtDateTime = (iso) => new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
export const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch { return false; }
  }
}

export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

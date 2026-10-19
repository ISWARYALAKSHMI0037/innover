import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { ExternalLink, Menu, X } from 'lucide-react';

export function Logo() {
  return (
    <span className="logo">
      <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden="true">
        <path d="M16 3.5l10 3.9v8c0 5.8-4 10.1-10 12.9-6-2.8-10-7.1-10-12.9v-8z" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <path d="M11.5 16.2l3.3 3.3 5.7-6.8" fill="none" stroke="var(--good)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span>OfferCheck</span>
    </span>
  );
}

export default function Layout() {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();

  useEffect(() => {
    setOpen(false);
    window.scrollTo({ top: 0 });
  }, [pathname]);

  return (
    <>
      <a className="skip-link" href="#main">Skip to content</a>
      <header className="site-header">
        <div className="container header-row">
          <Link to="/" className="brand" aria-label="OfferCheck home"><Logo /></Link>
          <button className="icon-btn nav-toggle" aria-expanded={open} aria-controls="site-nav" aria-label={open ? 'Close menu' : 'Open menu'} onClick={() => setOpen((o) => !o)}>
            {open ? <X size={22} /> : <Menu size={22} />}
          </button>
          <nav id="site-nav" className={`site-nav ${open ? 'open' : ''}`} aria-label="Main">
            <NavLink to="/analyze">Check an offer</NavLink>
            <NavLink to="/history">My history</NavLink>
            <NavLink to="/placement">Placement cell</NavLink>
            <Link to="/analyze" className="btn btn-primary btn-sm nav-cta">New check</Link>
          </nav>
        </div>
      </header>

      <main id="main" tabIndex={-1}>
        <Outlet />
      </main>

      <footer className="site-footer">
        <div className="container footer-grid">
          <div>
            <Logo />
            <p className="muted small footer-note">
              OfferCheck gives guidance from real domain, DNS and text checks. It is not a legal verdict and cannot prove an offer is genuine.
            </p>
          </div>
          <div>
            <h4>If you already paid</h4>
            <p className="small">
              Report it on the National Cyber Crime Reporting Portal{' '}
              <a href="https://cybercrime.gov.in" target="_blank" rel="noopener noreferrer">cybercrime.gov.in <ExternalLink size={13} aria-hidden /></a>{' '}
              or call <strong>1930</strong> (India) as soon as possible, and tell your bank.
            </p>
          </div>
          <div>
            <h4>Your data</h4>
            <p className="small">No account needed. Your history is tied to this browser. Placement cells only see anonymous totals, and only if you leave sharing on.</p>
          </div>
        </div>
      </footer>
    </>
  );
}

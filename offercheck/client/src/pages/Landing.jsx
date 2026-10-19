import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Info, CircleHelp, Database, Globe, Search, ShieldCheck, FileText, Users } from 'lucide-react';
import { useDocTitle } from '../ui.jsx';

const NOTES = [
  { id: 'free', tag: 'Verified fact', title: 'Sender uses a free email provider', body: "The domain after the @ is checked against a list of free mail providers. Established employers normally write from their own domain." },
  { id: 'guarantee', tag: 'Suspicious signal', title: 'Selection promised without a hiring process', body: 'Phrases like “no interview” and “guaranteed placement” are typical of fake offers.' },
  { id: 'pay', tag: 'Suspicious signal', title: 'Asks the candidate to pay', body: 'Found by text patterns and by the AI’s extraction of requested payments. Genuine employers do not charge candidates.' },
  { id: 'urgent', tag: 'Suspicious signal', title: 'Short deadline to act', body: 'Pressure reduces the time you have to verify. Quoted back to you as evidence.' },
];

function SampleOffer() {
  const [active, setActive] = useState(null);
  const hl = (id, children) => (
    <mark className={`hl ${active === id ? 'on' : ''}`} onMouseEnter={() => setActive(id)} onMouseLeave={() => setActive(null)}>{children}</mark>
  );
  return (
    <div className="sample">
      <div className="sample-doc" aria-label="Invented example offer email with highlighted warning signs">
        <p className="mono dim">From: “HR Desk” &lt;{hl('free', 'hr.brightpath.recruit@gmail.com')}&gt;</p>
        <p className="mono dim">Subject: Internship selection confirmation</p>
        <hr />
        <p>Congratulations! You are {hl('guarantee', 'selected as Software Intern without interview')}.</p>
        <p>To confirm your seat, pay a {hl('pay', 'refundable registration fee of ₹1,500')} via UPI {hl('urgent', 'within 24 hours')}. Seats are limited.</p>
        <p className="dim">Regards, Talent Team — Brightpath Systems</p>
      </div>
      <ul className="sample-notes">
        {NOTES.map((n) => (
          <li key={n.id} className={active === n.id ? 'on' : ''}>
            <button type="button" onFocus={() => setActive(n.id)} onBlur={() => setActive(null)} onMouseEnter={() => setActive(n.id)} onMouseLeave={() => setActive(null)}>
              <span className="note-tag">{n.tag}</span>
              <strong>{n.title}</strong>
              <span>{n.body}</span>
            </button>
          </li>
        ))}
      </ul>
      <p className="sample-caption"><Info size={15} aria-hidden /> Illustration with an invented company. Not a real analysis. For real offers, the sender’s domain is also looked up live (registration date via RDAP; mail and web records via DNS).</p>
    </div>
  );
}

export default function Landing() {
  useDocTitle();
  return (
    <>
      <section className="hero">
        <div className="container hero-grid">
          <div className="hero-copy">
            <h1>Check an offer before you pay, sign or reply.</h1>
            <p className="lead">
              Paste an email or upload the offer letter. OfferCheck reads it, runs real domain and email checks, and explains the evidence in plain English or Tamil.
            </p>
            <div className="cta-row">
              <Link to="/analyze" className="btn btn-primary btn-lg">Check an offer <ArrowRight size={18} aria-hidden /></Link>
              <a href="#checks" className="btn btn-ghost btn-lg">See what we check</a>
            </div>
            <ul className="hero-facts">
              <li><Globe size={16} aria-hidden /> Live RDAP + DNS lookups</li>
              <li><FileText size={16} aria-hidden /> PDF, image or pasted text</li>
              <li><ShieldCheck size={16} aria-hidden /> AI explains only the evidence it is given</li>
            </ul>
          </div>
          <SampleOffer />
        </div>
      </section>

      <section id="checks" className="section">
        <div className="container">
          <h2 className="section-title">Every result is sorted into what we know, what looks wrong, and what we could not check</h2>
          <div className="triple">
            <article className="panel group-verified">
              <h3><Database size={20} aria-hidden /> Verified facts</h3>
              <p className="muted">Looked up from an outside source or a fixed list, so you can repeat the check yourself.</p>
              <ul className="plain">
                <li><strong>Domain age</strong> from the registry’s RDAP service</li>
                <li><strong>DNS records</strong>: does the domain exist, can it receive mail, SPF and DMARC</li>
                <li><strong>Free and disposable email</strong> providers</li>
                <li><strong>Email header results</strong> if you paste raw headers</li>
              </ul>
            </article>
            <article className="panel group-suspicious">
              <h3><Search size={20} aria-hidden /> Suspicious signals</h3>
              <p className="muted">Patterns that scams often show. Each one quotes the text it found, so you can judge it.</p>
              <ul className="plain">
                <li><strong>Payment requests</strong>: fees, deposits, “refundable” amounts</li>
                <li><strong>Urgency</strong> and no-interview promises</li>
                <li><strong>Mismatches</strong> between company, sender and website</li>
                <li><strong>Look-alike domains</strong> of well-known employers</li>
              </ul>
            </article>
            <article className="panel group-unavailable">
              <h3><CircleHelp size={20} aria-hidden /> Unavailable checks</h3>
              <p className="muted">If a lookup times out or a check is outside this version, we say so. We never show a pass we did not earn.</p>
              <ul className="plain">
                <li>RDAP server did not answer</li>
                <li>No email headers supplied</li>
                <li>Company registry and blocklist lookups are not included</li>
              </ul>
            </article>
          </div>
        </div>
      </section>

      <section className="section section-alt">
        <div className="container">
          <h2 className="section-title">How one check runs</h2>
          <ol className="steps">
            <li><h3>Read</h3><p>A vision-capable AI model reads your PDF, screenshot or text and returns structured fields: company, sender, payments, deadlines, websites. Anything it reports that is not in your text is discarded.</p></li>
            <li><h3>Verify</h3><p>The server runs the lookups and pattern checks itself. The AI has no say in these results.</p></li>
            <li><h3>Explain</h3><p>The AI receives only the evidence from step 2 and writes the report in English or Tamil. It cannot add facts, and unsupported statements are removed before you see them.</p></li>
          </ol>
        </div>
      </section>

      <section className="section">
        <div className="container split">
          <div>
            <h2 className="section-title">What OfferCheck cannot do</h2>
            <ul className="plain limits">
              <li>It cannot prove an offer is genuine. A clean result only means these checks found nothing alarming.</li>
              <li>It never opens links in the offer. Type a company’s official address yourself.</li>
              <li>It does not look up company registration (MCA/GST) or phishing blocklists in this version.</li>
              <li>It is guidance, not a legal verdict.</li>
            </ul>
          </div>
          <div className="panel path-panel">
            <h3><Users size={20} aria-hidden /> For placement cells</h3>
            <p className="muted">See anonymous campus-level trends: which scam patterns are circulating, which sender domains keep appearing, and how new those domains are.</p>
            <Link to="/placement" className="btn btn-ghost">Open the placement dashboard <ArrowRight size={16} aria-hidden /></Link>
          </div>
        </div>
      </section>

      <section className="cta-band">
        <div className="container cta-band-row">
          <h2>Got an offer you are unsure about?</h2>
          <Link to="/analyze" className="btn btn-primary btn-lg">Check an offer <ArrowRight size={18} aria-hidden /></Link>
        </div>
      </section>
    </>
  );
}

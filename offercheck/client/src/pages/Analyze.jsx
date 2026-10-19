import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Check, CircleHelp, FileText, FileUp, Loader2, MinusCircle, Trash2, XCircle } from 'lucide-react';
import { api } from '../api.js';
import { usePrefs } from '../prefs.jsx';
import { Banner, formatBytes, useDocTitle, useToast } from '../ui.jsx';

const ALLOWED = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];
const EXT_OK = /\.(pdf|png|jpe?g|webp)$/i;

// Sample INPUT text for trying the tool. The company and domain are invented; the checks that run on it are real.
const SAMPLE_TEXT = `From: "HR Desk" <hr.brightpath.recruit@gmail.com>
Subject: Internship selection confirmation - Brightpath Systems

Dear Candidate,

Congratulations! You are selected as Software Intern at Brightpath Systems without interview.
To confirm your seat, pay a refundable registration fee of Rs. 1500 via UPI to 98xxxxxx21 within 24 hours.
Limited seats. Share your Aadhaar and bank account details on WhatsApp to proceed.

Visit www.brightpath-systems-careers.xyz for details.

Regards,
Talent Team`;

function StepIcon({ status }) {
  if (status === 'running') return <Loader2 className="spin" size={18} aria-hidden />;
  if (status === 'done') return <Check size={18} aria-hidden />;
  if (status === 'failed') return <XCircle size={18} aria-hidden />;
  if (status === 'skipped') return <MinusCircle size={18} aria-hidden />;
  return <CircleHelp size={18} aria-hidden />;
}

export function ProgressList({ steps }) {
  return (
    <ol className="progress" aria-live="polite">
      {(steps || []).map((s) => (
        <li key={s.key} className={`pstep pstep-${s.status}`}>
          <span className="pstep-icon"><StepIcon status={s.status} /></span>
          <div>
            <strong>{s.label}</strong>
            <span className="pstep-state">{{ pending: 'Waiting', running: 'Working…', done: 'Done', failed: 'Failed', skipped: 'Done with limits' }[s.status]}</span>
            {s.note && <p className="small muted">{s.note}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}

export default function Analyze() {
  useDocTitle('Check an offer');
  const navigate = useNavigate();
  const toast = useToast();
  const { language, setLanguage, college, setCollege, share, setShare } = usePrefs();

  const [health, setHealth] = useState(null);
  const [tab, setTab] = useState('text');
  const [text, setText] = useState('');
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [fileError, setFileError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [job, setJob] = useState(null); // { id, steps }
  const inputRef = useRef(null);

  const limits = health?.limits || { maxUploadMB: 8, maxTextChars: 20000, minTextChars: 20 };

  useEffect(() => {
    const ac = new AbortController();
    api.health(ac.signal).then(setHealth).catch((e) => { if (e.name !== 'AbortError') setHealth({ unreachable: true, message: e.message }); });
    return () => ac.abort();
  }, []);

  useEffect(() => () => preview && URL.revokeObjectURL(preview), [preview]);

  // Poll the real job status stored by the server
  useEffect(() => {
    if (!job?.id) return undefined;
    let stopped = false, fails = 0;
    const tick = async () => {
      try {
        const d = await api.getAnalysis(job.id);
        fails = 0;
        if (stopped) return;
        if (d.status === 'complete') { navigate(`/analysis/${d.id}`); return; }
        if (d.status === 'failed') { setJob(null); setSubmitting(false); setError(d.errorMessage || 'The analysis failed.'); return; }
        setJob({ id: d.id, steps: d.progress });
      } catch (e) {
        if (++fails >= 5 && !stopped) { setJob(null); setSubmitting(false); setError(e.message); return; }
      }
      if (!stopped) timer = setTimeout(tick, 1200);
    };
    let timer = setTimeout(tick, 600);
    return () => { stopped = true; clearTimeout(timer); };
  }, [job?.id, navigate]);

  const pickFile = useCallback((f) => {
    setFileError('');
    if (!f) return;
    if (!(ALLOWED.includes(f.type) || EXT_OK.test(f.name))) { setFileError('Only PDF, PNG, JPG or WebP files are accepted.'); return; }
    if (f.size > limits.maxUploadMB * 1048576) { setFileError(`That file is ${formatBytes(f.size)}. The limit is ${limits.maxUploadMB} MB.`); return; }
    if (f.size === 0) { setFileError('That file is empty.'); return; }
    setFile(f);
    setPreview(f.type.startsWith('image/') ? URL.createObjectURL(f) : null);
  }, [limits.maxUploadMB]);

  const clearFile = () => { setFile(null); setPreview(null); setFileError(''); if (inputRef.current) inputRef.current.value = ''; };

  const textLen = text.trim().length;
  const textOk = textLen >= limits.minTextChars && text.length <= limits.maxTextChars;
  const canSubmit = !submitting && (tab === 'text' ? textOk : !!file);

  async function submit(e) {
    e.preventDefault();
    if (!canSubmit) return;
    setError('');
    setSubmitting(true);
    const fd = new FormData();
    if (tab === 'text') fd.append('text', text); else fd.append('file', file);
    fd.append('language', language);
    fd.append('shareWithCampus', String(share));
    if (college.trim()) fd.append('college', college.trim());
    try {
      const { id } = await api.analyze(fd);
      setJob({ id, steps: [{ key: 'extract', label: 'Reading the offer', status: 'pending' }, { key: 'verify', label: 'Running live checks (RDAP + DNS + text analysis)', status: 'pending' }, { key: 'report', label: 'Writing the evidence-based report', status: 'pending' }] });
    } catch (err) {
      setSubmitting(false);
      setError(err.message);
    }
  }

  function cancel() {
    setJob(null); setSubmitting(false);
    toast('Stopped waiting. The analysis may still finish and appear in My history.');
  }

  const dbDown = health && !health.unreachable && health.db !== 'connected';
  const noKey = health && !health.unreachable && !health.llm?.configured;

  return (
    <div className="container page narrow">
      <h1 className="page-title">Check an offer</h1>
      <p className="muted lead-sm">Paste the email or upload the letter. Checks use real lookups and take about 10–40 seconds.</p>

      {health?.unreachable && <Banner tone="error" title="Server not reachable">{health.message}</Banner>}
      {dbDown && <Banner tone="error" title="Database offline">MongoDB is not connected, so analyses cannot be saved. Start MongoDB or fix MONGODB_URI in server/.env.</Banner>}
      {noKey && <Banner tone="warn" title="AI key not configured">Pasted text still gets real RDAP/DNS and pattern checks using basic extraction and a rule-based report. Images, scanned PDFs, company-name matching and Tamil reports need an LLM key in server/.env.</Banner>}

      {job ? (
        <section className="panel progress-panel" aria-label="Analysis progress">
          <h2>Analysing your offer</h2>
          <ProgressList steps={job.steps} />
          <button className="btn btn-ghost" onClick={cancel}>Stop waiting</button>
        </section>
      ) : (
        <form className="panel form" onSubmit={submit} noValidate>
          <div className="tabs" role="tablist" aria-label="Input type">
            <button type="button" role="tab" id="tab-text" aria-selected={tab === 'text'} aria-controls="pane-text" className={tab === 'text' ? 'on' : ''} onClick={() => setTab('text')}><FileText size={16} aria-hidden /> Paste text</button>
            <button type="button" role="tab" id="tab-file" aria-selected={tab === 'file'} aria-controls="pane-file" className={tab === 'file' ? 'on' : ''} onClick={() => setTab('file')}><FileUp size={16} aria-hidden /> Upload PDF or image</button>
          </div>

          {tab === 'text' ? (
            <div id="pane-text" role="tabpanel" aria-labelledby="tab-text">
              <label htmlFor="offer-text" className="label">Offer email or message</label>
              <textarea id="offer-text" rows={12} value={text} onChange={(e) => setText(e.target.value)} placeholder={'Paste the full email. Including the From line (and raw headers, if you can) lets us run more checks.'} aria-describedby="text-help" />
              <div id="text-help" className="field-meta">
                <span className={text.length > limits.maxTextChars ? 'bad-text' : 'muted'}>{text.length.toLocaleString()} / {limits.maxTextChars.toLocaleString()} characters{textLen > 0 && textLen < limits.minTextChars ? ` · add at least ${limits.minTextChars - textLen} more` : ''}</span>
                <button type="button" className="link-btn" onClick={() => setText(SAMPLE_TEXT)}>Try sample text</button>
                {text && <button type="button" className="link-btn" onClick={() => setText('')}>Clear</button>}
              </div>
              {text === SAMPLE_TEXT && <p className="small muted">The sample uses an invented company. The lookups that run on its domains are real, so results show what was actually found.</p>}
            </div>
          ) : (
            <div id="pane-file" role="tabpanel" aria-labelledby="tab-file">
              {!file ? (
                <div
                  className={`dropzone ${dragging ? 'drag' : ''}`}
                  onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(e) => { e.preventDefault(); setDragging(false); pickFile(e.dataTransfer.files?.[0]); }}
                >
                  <FileUp size={30} aria-hidden />
                  <p><strong>Drop a file here</strong> or</p>
                  <button type="button" className="btn btn-ghost" onClick={() => inputRef.current?.click()}>Choose a file</button>
                  <p className="small muted">PDF, PNG, JPG or WebP · up to {limits.maxUploadMB} MB</p>
                </div>
              ) : (
                <div className="file-chip">
                  {preview ? <img src={preview} alt="Preview of the uploaded offer" /> : <FileText size={34} aria-hidden />}
                  <div><strong>{file.name}</strong><span className="small muted">{formatBytes(file.size)}</span></div>
                  <button type="button" className="icon-btn" onClick={clearFile} aria-label="Remove file"><Trash2 size={18} /></button>
                </div>
              )}
              <input ref={inputRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp" hidden onChange={(e) => pickFile(e.target.files?.[0])} aria-label="Offer file" />
              {fileError && <p className="field-error" role="alert"><AlertTriangle size={15} aria-hidden /> {fileError}</p>}
            </div>
          )}

          <div className="options">
            <fieldset>
              <legend className="label">Report language</legend>
              <div className="seg">
                {[['en', 'English'], ['ta', 'தமிழ்']].map(([v, l]) => (
                  <label key={v} className={language === v ? 'on' : ''}>
                    <input type="radio" name="lang" value={v} checked={language === v} onChange={() => setLanguage(v)} />
                    <span lang={v === 'ta' ? 'ta' : undefined}>{l}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div>
              <label htmlFor="college" className="label">College (optional)</label>
              <input id="college" type="text" maxLength={80} value={college} onChange={(e) => setCollege(e.target.value)} placeholder="So your placement cell sees totals for your campus" autoComplete="organization" />
            </div>
          </div>
          <label className="check">
            <input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} />
            <span>Include this check in anonymous campus statistics <span className="muted small">(counts and sender domains only; never your text, name or file)</span></span>
          </label>

          {error && <Banner tone="error" title="Could not complete the check">{error}</Banner>}

          <div className="form-actions">
            <button type="submit" className="btn btn-primary btn-lg" disabled={!canSubmit}>
              {submitting ? <><Loader2 className="spin" size={18} aria-hidden /> Starting…</> : 'Run checks'}
            </button>
            {!canSubmit && !submitting && <span className="small muted">{tab === 'text' ? `Paste at least ${limits.minTextChars} characters to begin.` : 'Choose a file to begin.'}</span>}
          </div>
        </form>
      )}
    </div>
  );
}

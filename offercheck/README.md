# OfferCheck — Fake Job & Internship Offer Verifier

React + Vite · Node.js + Express · MongoDB · vision-capable LLM · RDAP · DNS · PDF parsing · image processing (sharp)

Students paste an offer email or upload a PDF/screenshot. The server **extracts** the facts with an LLM, **verifies** them with real lookups, and the LLM then **explains only that evidence** in English or Tamil. Placement cells get an anonymous campus dashboard.

## Quick start

Requirements: Node 18.18+ (22 recommended), MongoDB running locally (or an Atlas URI), an Anthropic or OpenAI-compatible API key.

```bash
npm run install:all                 # installs root, server and client
cp server/.env.example server/.env  # then edit server/.env
npm run dev                         # API on :5000, web on :5173
```

Open http://localhost:5173. Check `http://localhost:5000/api/health` to see DB / LLM status.

`server/.env` essentials:

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` (+ `LLM_PROVIDER=anthropic`) | Vision LLM. Reads images and scanned PDFs natively. |
| `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL` (+ `LLM_PROVIDER=openai`) | Any OpenAI-compatible vision model. Scanned PDFs must be uploaded as images. |
| `MONGODB_URI` | Where analyses are stored. |
| `PLACEMENT_CELL_PASSCODE` | Required to open the placement dashboard. **Set it.** |
| `ALLOW_DEMO_SEED` | Enables the clearly-labelled sample-data buttons. Set `false` in production. |

The key lives only in `server/.env`; the browser never sees it (the Vite dev server proxies `/api`).

### Without an API key
Text offers still get real RDAP/DNS/pattern checks with basic regex extraction and a rule-based report; the UI says so. Images, scanned PDFs, company-name matching and Tamil reports need the key.

## Scripts
- `npm test` — 13 unit tests (verification engine, grounding, risk clamping, fallback; LLM calls are mocked).
- `npm run seed` / `npm run seed --prefix server -- --remove` — create/remove **sample** records (`isSample: true`).
- `npm run build && SERVE_CLIENT=true npm start` — single-service production run (Express serves `client/dist`).

## Deploy
Single service (Render/Railway/Fly): build command `npm run install:all && npm run build`, start command `npm start`, env `NODE_ENV=production`, `TRUST_PROXY=true`, `MONGODB_URI` (Atlas), API key, passcode, `ALLOW_DEMO_SEED=false`. Split deploy: host `client/dist` statically, set `VITE_API_URL` at build time and `CLIENT_ORIGIN` on the API.

## How it works

```
upload/text ─► validate (magic bytes, size, sharp/pdf-parse) ─► 202 {id}
                         │ background pipeline, progress stored in MongoDB (UI polls it)
                         ▼
  1 EXTRACT  LLM → strict JSON; emails/domains/phones not literally in the source text are discarded
  2 VERIFY   RDAP (IANA bootstrap) · DNS (MX/A/NS/SPF/DMARC) · free/disposable email list ·
             payment / urgency / credential / no-interview patterns · company↔sender↔website mismatch ·
             look-alike & brand impersonation · TLD / shortener heuristics · pasted-header SPF/DKIM/DMARC
  3 EXPLAIN  LLM gets ONLY the evidence JSON → risk level, reasons (must cite check ids), next steps
```

**Three evidence groups:** *Verified facts* (outside source or fixed list), *Suspicious signals* (heuristics with quoted evidence), *Unavailable checks* (timeouts, missing input, features not in this version). A failed lookup is never shown as a pass.

**Scoring:** transparent points per signal (e.g. payment 40, domain < 30 days 35, free email 18). Signals of the same kind are not double-counted. Score → Low (<20), Medium (20–49), High (≥50); a payment or credential request sets a floor of Medium.

**Keeping the AI honest**
- The explanation step never sees raw offer text, only structured evidence.
- Offer text is treated as untrusted (prompt-injection warning in prompts; instructions inside it are ignored).
- The AI may move the risk level at most one step from the rule-based level.
- Reasons without valid evidence ids, and any sentence containing a domain, email or number not present in the evidence, are removed. Disclaimer text is fixed server-side (English and Tamil), not model-generated.
- If the AI fails, a deterministic rule-based report is shown and labelled as such.

## Security
Server-side secrets only · helmet, CORS allow-list, JSON body limit · rate limits (analyze: 15 per 10 min per IP) · multer memory upload with 1 file, type filter, size cap, **magic-byte sniffing**, image decompression-bomb limit, re-encoding (strips metadata) · input validation on every route · regex-escaped search · timing-safe passcode comparison · no URL in an offer is ever fetched (RDAP/DNS lookups only, on syntactically validated public domains) · placement stats expose only counts and sender domains of high-risk offers.

## Known limitations (honest list)
- **No accounts.** History is tied to an anonymous per-browser id; clearing site data loses access. The passcode is a shared secret, not user auth. Add real auth before a wide rollout.
- RDAP coverage varies by registry; some redact dates or rate-limit. These show as *unavailable*.
- Heuristics can misfire (a startup on Gmail; a parent-company domain). Each result says what was matched.
- Not included: MCA/GST registry, phone-number ownership, phishing blocklists (listed as unavailable checks in every report).
- Brand list is small and built in. Image transcription by the LLM can contain reading errors (flagged in the UI).
- Campus statistics are computed in memory from up to 10,000 records; use Mongo aggregation if you outgrow that.

## Structure
```
server/src  config · index · routes/{analyses,placement,health} · middleware/{security,upload}
            models/Analysis · services/{llm,extraction,report,pipeline,aggregate,sampleData,signalLabels}
            services/verification/{index,signals,heuristics,rdap,dns} · utils/{domain,emailProviders}
server/test verification.test.js · report.test.js
client/src  pages/{Landing,Analyze,Result,History,Placement,NotFound} · components/{Layout,Charts} · api · prefs · ui · styles.css
```

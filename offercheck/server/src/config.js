// All configuration comes from environment variables (see .env.example).
// dotenv is loaded in index.js before this module is evaluated.

const num = (v, d) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : d;
};

const env = process.env;

const provider = (
  env.LLM_PROVIDER ||
  (env.GEMINI_API_KEY
    ? 'gemini'
    : env.ANTHROPIC_API_KEY
      ? 'anthropic'
      : env.OPENAI_API_KEY
        ? 'openai'
        : 'anthropic')
).toLowerCase();

export const config = {
  env: env.NODE_ENV || 'development',
  port: num(env.PORT, 5000),
  mongoUri: env.MONGODB_URI || 'mongodb://127.0.0.1:27017/offercheck',

  clientOrigins: (env.CLIENT_ORIGIN || 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  trustProxy: env.TRUST_PROXY === 'true',
  serveClient: env.SERVE_CLIENT === 'true',

  llm: {
    provider,
    timeoutMs: num(env.LLM_TIMEOUT_MS, 90000),

    anthropic: {
      apiKey: env.ANTHROPIC_API_KEY || '',
      model: env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
    },

    openai: {
      apiKey: env.OPENAI_API_KEY || '',
      model: env.OPENAI_MODEL || 'gpt-4o-mini',
      baseUrl: (
        env.OPENAI_BASE_URL || 'https://api.openai.com/v1'
      ).replace(/\/+$/, ''),
    },

    gemini: {
      apiKey: env.GEMINI_API_KEY || '',
      model: env.GEMINI_MODEL || 'gemini-2.5-flash',
      baseUrl: (
        env.GEMINI_BASE_URL ||
        'https://generativelanguage.googleapis.com/v1beta/openai'
      ).replace(/\/+$/, ''),
    },
  },

  upload: {
    maxBytes: num(env.MAX_UPLOAD_MB, 8) * 1024 * 1024,
    maxTextChars: 20000,
    minTextChars: 20,
  },

  rdapTimeoutMs: num(env.RDAP_TIMEOUT_MS, 8000),
  dnsTimeoutMs: num(env.DNS_TIMEOUT_MS, 4000),

  placementPasscode: env.PLACEMENT_CELL_PASSCODE || '',
  allowDemoSeed: env.ALLOW_DEMO_SEED === 'true',
};
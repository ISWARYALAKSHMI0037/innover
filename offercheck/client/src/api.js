const BASE = import.meta.env.VITE_API_URL || '/api';

export class ApiError extends Error {
  constructor(message, code, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function uuid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 3) | 8).toString(16);
  });
}

// Anonymous per-browser identity: history is tied to this id, there are no accounts in the MVP.
export function getClientId() {
  try {
    let id = localStorage.getItem('oc_client_id');
    if (!id) {
      id = uuid();
      localStorage.setItem('oc_client_id', id);
    }
    return id;
  } catch {
    return 'session-' + uuid();
  }
}

export const passcodeStore = {
  get: () => { try { return sessionStorage.getItem('oc_passcode') || ''; } catch { return ''; } },
  set: (v) => { try { sessionStorage.setItem('oc_passcode', v); } catch { /* ignore */ } },
  clear: () => { try { sessionStorage.removeItem('oc_passcode'); } catch { /* ignore */ } },
};

async function request(path, { method = 'GET', body, form, placement = false, signal } = {}) {
  const headers = { 'X-Client-Id': getClientId() };
  if (placement) headers['X-Placement-Passcode'] = passcodeStore.get();
  if (body) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(BASE + path, { method, headers, body: form || (body ? JSON.stringify(body) : undefined), signal });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    throw new ApiError("Can't reach the OfferCheck server. Check that the API is running and that you are online.", 'network', 0);
  }
  let data = null;
  try { data = await res.json(); } catch { /* non-JSON body */ }
  if (!res.ok) throw new ApiError(data?.error?.message || `Request failed (HTTP ${res.status}).`, data?.error?.code || 'http_error', res.status);
  return data;
}

const qs = (o) => {
  const p = new URLSearchParams();
  Object.entries(o || {}).forEach(([k, v]) => v !== undefined && v !== null && v !== '' && p.set(k, v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

export const api = {
  health: (signal) => request('/health', { signal }),
  analyze: (form) => request('/analyze', { method: 'POST', form }),
  getAnalysis: (id, signal) => request(`/analyses/${id}`, { signal }),
  listAnalyses: (params, signal) => request(`/analyses${qs(params)}`, { signal }),
  deleteAnalysis: (id) => request(`/analyses/${id}`, { method: 'DELETE' }),
  myStats: (signal) => request('/stats/me', { signal }),
  placementMeta: (signal) => request('/placement/meta', { placement: true, signal }),
  placementStats: (params, signal) => request(`/placement/stats${qs(params)}`, { placement: true, signal }),
  seedSample: () => request('/placement/sample', { method: 'POST', placement: true }),
  removeSample: () => request('/placement/sample', { method: 'DELETE', placement: true }),
};

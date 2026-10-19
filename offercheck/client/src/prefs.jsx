import { createContext, useContext, useEffect, useMemo, useState } from 'react';

const PrefsContext = createContext(null);
const KEY = 'oc_prefs';

function load() {
  try { return { language: 'en', college: '', share: true, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { language: 'en', college: '', share: true }; }
}

export function PrefsProvider({ children }) {
  const [prefs, setPrefs] = useState(load);
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* ignore */ } }, [prefs]);
  const value = useMemo(() => ({ ...prefs, setLanguage: (language) => setPrefs((p) => ({ ...p, language })), setCollege: (college) => setPrefs((p) => ({ ...p, college })), setShare: (share) => setPrefs((p) => ({ ...p, share })) }), [prefs]);
  return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>;
}

export const usePrefs = () => useContext(PrefsContext);

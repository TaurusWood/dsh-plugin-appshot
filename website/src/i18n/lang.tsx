import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { dicts } from './dict'
import type { Dict, Lang } from './dict'

const STORAGE_KEY = 'appshot-lang'

interface LangContextValue {
  lang: Lang
  t: Dict
  setLang: (lang: Lang) => void
}

const LangContext = createContext<LangContextValue | null>(null)

function detectInitialLang(): Lang {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'en' || stored === 'zh') return stored
  } catch {
    // storage unavailable (privacy mode etc.) — fall through to detection
  }
  return navigator.language?.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

function persistLang(lang: Lang) {
  try {
    localStorage.setItem(STORAGE_KEY, lang)
  } catch {
    // non-fatal: the choice just won't survive a reload
  }
}

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(detectInitialLang)

  const setLang = useCallback((next: Lang) => {
    setLangState(next)
    persistLang(next)
  }, [])

  useEffect(() => {
    const { title, description } = dicts[lang].meta
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en'
    document.title = title
    document.querySelector('meta[name="description"]')?.setAttribute('content', description)
  }, [lang])

  const value = useMemo<LangContextValue>(() => ({ lang, t: dicts[lang], setLang }), [lang, setLang])

  return <LangContext.Provider value={value}>{children}</LangContext.Provider>
}

export function useLang(): LangContextValue {
  const ctx = useContext(LangContext)
  if (!ctx) throw new Error('useLang must be used within LangProvider')
  return ctx
}

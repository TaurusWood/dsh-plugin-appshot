import { useEffect, useRef, useState } from 'react'
import { useLang } from '../i18n/lang'
import { GitHubIcon, BrandMark, MenuIcon, CloseIcon } from './icons'
import './Header.css'

const GITHUB_URL = 'https://github.com/TaurusWood/dsh-plugin-appshot'

function LangToggle() {
  const { lang, setLang, t } = useLang()
  return (
    <div className="lang-toggle" role="group" aria-label={t.nav.switchLang}>
      <button
        type="button"
        className={lang === 'en' ? 'lang-btn active' : 'lang-btn'}
        aria-pressed={lang === 'en'}
        onClick={() => setLang('en')}
      >
        EN
      </button>
      <button
        type="button"
        className={lang === 'zh' ? 'lang-btn active' : 'lang-btn'}
        aria-pressed={lang === 'zh'}
        onClick={() => setLang('zh')}
      >
        中文
      </button>
    </div>
  )
}

export function Header() {
  const { t } = useLang()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    const onClick = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onClick)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onClick)
    }
  }, [menuOpen])

  const links = [
    { href: '#features', label: t.nav.features },
    { href: '#how-it-works', label: t.nav.how },
    { href: '#install', label: t.nav.install },
  ]

  return (
    <header className="site-header">
      <div className="container header-row">
        <a className="brand" href="#top" aria-label="Appshot — top">
          <BrandMark className="brand-mark" />
          <span className="brand-name">Appshot</span>
          <span className="brand-sep" aria-hidden="true" />
          <span className="brand-tag">{t.nav.tagline}</span>
        </a>

        <nav className="header-nav" aria-label="Sections">
          {links.map((link) => (
            <a key={link.href} className="header-link" href={link.href}>
              {link.label}
            </a>
          ))}
        </nav>

        <div className="header-actions">
          <LangToggle />
          <a
            className="header-github"
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            aria-label={t.nav.github}
          >
            <GitHubIcon />
          </a>
          <div className="mobile-menu" ref={menuRef}>
            <button
              type="button"
              className="mobile-menu-btn"
              aria-expanded={menuOpen}
              aria-controls="mobile-menu-panel"
              aria-label={menuOpen ? t.nav.closeMenu : t.nav.openMenu}
              onClick={() => setMenuOpen((open) => !open)}
            >
              {menuOpen ? <CloseIcon /> : <MenuIcon />}
            </button>
            {menuOpen && (
              <div className="mobile-menu-panel" id="mobile-menu-panel">
                {links.map((link) => (
                  <a key={link.href} className="mobile-menu-link" href={link.href} onClick={() => setMenuOpen(false)}>
                    {link.label}
                  </a>
                ))}
                <a
                  className="mobile-menu-link"
                  href={GITHUB_URL}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => setMenuOpen(false)}
                >
                  <GitHubIcon size={15} /> {t.nav.github}
                </a>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  )
}

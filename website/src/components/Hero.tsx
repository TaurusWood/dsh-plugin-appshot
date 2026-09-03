import { useLang } from '../i18n/lang'
import { HeroFlow } from './HeroFlow'
import { GitHubIcon } from './icons'
import './Hero.css'

const GITHUB_URL = 'https://github.com/TaurusWood/dsh-plugin-appshot'

export function Hero() {
  const { t } = useLang()
  return (
    <section className="hero" id="top">
      <div className="container hero-grid">
        <div className="hero-copy">
          <p className="hero-eyebrow">{t.hero.eyebrow}</p>
          <h1 className="hero-title">
            {t.hero.titleA}
            <br />
            {t.hero.titleB}
          </h1>
          <p className="hero-sub">{t.hero.sub}</p>
          <div className="hero-cta">
            <a className="btn btn-primary" href="#install">
              {t.hero.ctaInstall}
            </a>
            <a className="btn btn-ghost" href={GITHUB_URL} target="_blank" rel="noreferrer">
              <GitHubIcon size={16} />
              {t.hero.ctaGithub}
            </a>
          </div>
          <p className="hero-platforms">
            <span>{t.hero.platforms}</span>
            <span aria-hidden="true">·</span>
            <span>{t.hero.platformsWin}</span>
            <span aria-hidden="true">·</span>
            <span>{t.hero.license}</span>
          </p>
        </div>
        <HeroFlow />
      </div>
    </section>
  )
}

import { useLang } from '../i18n/lang'
import { Reveal } from './Reveal'
import { GitHubIcon } from './icons'
import './Cta.css'

const REPO = 'https://github.com/TaurusWood/dsh-plugin-appshot'

export function Cta() {
  const { t } = useLang()
  return (
    <section className="cta">
      <div className="container cta-inner">
        <Reveal>
          <h2 className="cta-title">{t.cta.title}</h2>
          <p className="cta-sub">{t.cta.sub}</p>
        </Reveal>
        <Reveal delay={100}>
          <div className="cta-buttons">
            <a className="btn btn-primary" href={REPO} target="_blank" rel="noreferrer">
              <GitHubIcon size={16} />
              {t.cta.primary}
            </a>
            <a className="btn btn-ghost" href={`${REPO}/issues`} target="_blank" rel="noreferrer">
              {t.cta.secondary}
            </a>
          </div>
        </Reveal>
        <Reveal delay={160}>
          <p className="cta-links">
            <a href={`${REPO}/blob/main/README.en.md`} target="_blank" rel="noreferrer">
              {t.cta.links.readme}
            </a>
            <span aria-hidden="true">·</span>
            <a href={`${REPO}/blob/main/README.md`} target="_blank" rel="noreferrer">
              {t.cta.links.readmeZh}
            </a>
            <span aria-hidden="true">·</span>
            <a href="https://www.npmjs.com/package/dsh-plugin-appshot" target="_blank" rel="noreferrer">
              {t.cta.links.npm}
            </a>
            <span aria-hidden="true">·</span>
            <a href={`${REPO}/blob/main/CHANGELOG.md`} target="_blank" rel="noreferrer">
              {t.cta.links.changelog}
            </a>
          </p>
        </Reveal>
      </div>
    </section>
  )
}

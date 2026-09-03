import { useLang } from '../i18n/lang'
import { Section } from './Section'
import { Reveal } from './Reveal'
import windowCapture from '../assets/window-capture.jpg'
import dshComposer from '../assets/dsh-composer.jpg'
import './Platforms.css'

export function Platforms() {
  const { t } = useLang()
  const { mac, win } = t.platforms

  return (
    <Section id="platforms" index="05" eyebrow={t.platforms.eyebrow} title={t.platforms.title} sub={t.platforms.sub}>
      <div className="platform-grid">
        <Reveal className="platform-panel card">
          <div className="platform-head">
            <h3 className="platform-name">{mac.name}</h3>
            <span className="platform-keys" aria-hidden="true">
              <span className="keycap pk-key">{mac.keysA}</span>
              <span className="keycap-plus">+</span>
              <span className="keycap pk-key">{mac.keysB}</span>
            </span>
            <span className="platform-keys-label">{mac.keysLabel}</span>
          </div>

          <div className="platform-media">
            <figure className="pm-item">
              <img src={windowCapture} alt={mac.beforeLabel} loading="lazy" />
              <figcaption>{mac.beforeLabel}</figcaption>
            </figure>
            <figure className="pm-item">
              <img src={dshComposer} alt={mac.afterLabel} loading="lazy" />
              <figcaption>{mac.afterLabel}</figcaption>
            </figure>
          </div>

          <ul className="platform-points">
            {mac.points.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>

          <p className="platform-tags" aria-hidden="true">
            {mac.tags.map((tag) => (
              <span key={tag}>{tag}</span>
            ))}
          </p>
        </Reveal>

        <Reveal className="platform-panel card" delay={110}>
          <div className="platform-head">
            <h3 className="platform-name">{win.name}</h3>
            <span className="platform-keys" aria-hidden="true">
              <span className="keycap pk-key">{win.keysA}</span>
              <span className="keycap-plus">+</span>
              <span className="keycap pk-key">{win.keysB}</span>
            </span>
            <span className="platform-keys-label">{win.keysLabel}</span>
          </div>

          <div className="platform-silent" aria-hidden="true">
            <span className="ps-line" />
            <span className="ps-badge">{win.silentBadge}</span>
            <span className="ps-line" />
          </div>

          <ul className="platform-points">
            {win.points.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>

          <p className="platform-tags" aria-hidden="true">
            {win.tags.map((tag) => (
              <span key={tag}>{tag}</span>
            ))}
          </p>
        </Reveal>
      </div>
    </Section>
  )
}

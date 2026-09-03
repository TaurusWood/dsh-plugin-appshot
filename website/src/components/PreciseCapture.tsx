import { useLang } from '../i18n/lang'
import { Section } from './Section'
import { Reveal } from './Reveal'
import { CheckIcon, CloseIcon, CaptureBrackets } from './icons'
import windowCapture from '../assets/window-capture.jpg'
import './PreciseCapture.css'

export function PreciseCapture() {
  const { t } = useLang()
  return (
    <Section id="precise" index="03" eyebrow={t.precise.eyebrow} title={t.precise.title} sub={t.precise.sub}>
      <div className="precise-grid">
        <Reveal className="precise-visual">
          <div className="pc-desktop card">
            <div className="pc-menubar" aria-hidden="true">
              <i />
              <i />
              <i />
            </div>
            <div className="pc-screen">
              <div className="pc-win pc-win-dim pc-win-left" aria-hidden="true" />
              <div className="pc-win pc-win-dim pc-win-right" aria-hidden="true">
                <span className="pc-tag">{t.precise.ignoredLabel}</span>
              </div>
              <figure className="pc-win pc-win-main">
                <img src={windowCapture} alt="" loading="lazy" draggable={false} />
                <CaptureBrackets className="pc-brackets" />
                <figcaption className="pc-tag pc-tag-accent">{t.precise.capturedLabel}</figcaption>
              </figure>
              <span className="pc-label">{t.precise.desktopLabel}</span>
            </div>
          </div>
        </Reveal>

        <div className="precise-lists">
          <Reveal className="pc-list-card">
            <p className="pc-list-title">{t.precise.yesTitle}</p>
            <ul className="pc-list">
              {t.precise.yes.map((item) => (
                <li key={item}>
                  <span className="pc-ico pc-ico-yes">
                    <CheckIcon size={11} />
                  </span>
                  {item}
                </li>
              ))}
            </ul>
          </Reveal>
          <Reveal className="pc-list-card" delay={110}>
            <p className="pc-list-title">{t.precise.noTitle}</p>
            <ul className="pc-list">
              {t.precise.no.map((item) => (
                <li key={item}>
                  <span className="pc-ico pc-ico-no">
                    <CloseIcon size={11} />
                  </span>
                  {item}
                </li>
              ))}
            </ul>
          </Reveal>
        </div>
      </div>
    </Section>
  )
}

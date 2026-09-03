import { useLang } from '../i18n/lang'
import { Section } from './Section'
import { Reveal } from './Reveal'
import dshLightbox from '../assets/dsh-lightbox.jpg'
import './HowItWorks.css'

export function HowItWorks() {
  const { t } = useLang()
  return (
    <Section id="how-it-works" index="02" eyebrow={t.how.eyebrow} title={t.how.title} sub={t.how.sub}>
      <div className="how-grid">
        <ol className="how-steps">
          {t.how.steps.map((step, i) => (
            <li key={step.title} className="how-step">
              <Reveal delay={i * 90}>
                <span className="how-num">{String(i + 1).padStart(2, '0')}</span>
                <h3 className="how-step-title">{step.title}</h3>
                <p className="how-step-body">{step.body}</p>
              </Reveal>
            </li>
          ))}
        </ol>
        <Reveal className="how-visual" delay={140}>
          <figure className="how-figure card">
            <img src={dshLightbox} alt={t.how.visualAlt} loading="lazy" />
          </figure>
          <p className="how-caption">{t.how.visualCaption}</p>
        </Reveal>
      </div>
    </Section>
  )
}

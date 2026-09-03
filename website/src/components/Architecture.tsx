import { useLang } from '../i18n/lang'
import { Section } from './Section'
import { Reveal } from './Reveal'
import { ArrowRightIcon } from './icons'
import './Architecture.css'

const GITHUB_URL = 'https://github.com/TaurusWood/dsh-plugin-appshot'

export function Architecture() {
  const { t } = useLang()
  return (
    <Section id="architecture" index="06" eyebrow={t.architecture.eyebrow} title={t.architecture.title} sub={t.architecture.sub}>
      <Reveal>
        <div className="arch-flow" role="img" aria-label={`${t.architecture.transports.mac}; ${t.architecture.transports.win}`}>
          <ol className="arch-nodes">
            {t.architecture.nodes.map((node, i) => (
              <li key={node.name} className="arch-item">
                {i > 0 && (
                  <span className="arch-arrow" aria-hidden="true">
                    <ArrowRightIcon />
                  </span>
                )}
                <div className="arch-node card">
                  <span className="arch-node-name">{node.name}</span>
                  {node.lines.map((line) => (
                    <span key={line} className="arch-node-line">
                      {line}
                    </span>
                  ))}
                </div>
              </li>
            ))}
          </ol>
          <div className="arch-transports">
            <p>{t.architecture.transports.mac}</p>
            <p>{t.architecture.transports.win}</p>
          </div>
        </div>
      </Reveal>

      <div className="arch-principles">
        {t.architecture.principles.map((principle, i) => (
          <Reveal key={principle.title} delay={i * 90}>
            <div className="arch-principle card">
              <h3 className="arch-principle-title">{principle.title}</h3>
              <p className="arch-principle-body">{principle.body}</p>
            </div>
          </Reveal>
        ))}
      </div>

      <Reveal>
        <a className="arch-docs" href={`${GITHUB_URL}#readme`} target="_blank" rel="noreferrer">
          {t.architecture.docsLink} →
        </a>
      </Reveal>
    </Section>
  )
}

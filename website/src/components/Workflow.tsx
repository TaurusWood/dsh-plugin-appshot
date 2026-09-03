import { Fragment } from 'react'
import { useLang } from '../i18n/lang'
import { Section } from './Section'
import { Reveal } from './Reveal'
import { ArrowRightIcon } from './icons'
import './Workflow.css'

function StepFlow({ steps, variant }: { steps: readonly string[]; variant: 'old' | 'new' }) {
  return (
    <ol className={`path-steps path-${variant}`}>
      {steps.map((step) => (
        <Fragment key={step}>
          {steps.indexOf(step) > 0 && (
            <li className="path-arrow" aria-hidden="true">
              <ArrowRightIcon />
            </li>
          )}
          <li className="path-step">{step}</li>
        </Fragment>
      ))}
    </ol>
  )
}

export function Workflow() {
  const { t } = useLang()
  return (
    <Section id="workflow" index="01" eyebrow={t.workflow.eyebrow} title={t.workflow.title} sub={t.workflow.sub}>
      <div className="workflow-paths">
        <Reveal className="workflow-path">
          <p className="path-name">{t.workflow.oldTitle}</p>
          <StepFlow steps={t.workflow.oldSteps} variant="old" />
        </Reveal>
        <Reveal className="workflow-path" delay={120}>
          <p className="path-name path-name-new">{t.workflow.newTitle}</p>
          <StepFlow steps={t.workflow.newSteps} variant="new" />
        </Reveal>
      </div>
      <Reveal>
        <p className="workflow-note">{t.workflow.note}</p>
      </Reveal>
    </Section>
  )
}

import type { ReactNode } from 'react'
import { Reveal } from './Reveal'

interface SectionProps {
  id: string
  index: string
  eyebrow: string
  title: string
  sub?: string
  children: ReactNode
}

export function Section({ id, index, eyebrow, title, sub, children }: SectionProps) {
  return (
    <section className="section" id={id}>
      <div className="container">
        <Reveal className="section-head">
          <p className="eyebrow">
            <span className="eyebrow-index">{index}</span>
            {eyebrow}
          </p>
          <h2 className="section-title">{title}</h2>
          {sub && <p className="section-sub">{sub}</p>}
        </Reveal>
        {children}
      </div>
    </section>
  )
}

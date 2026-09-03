import { useEffect, useRef, useState } from 'react'
import { useLang } from '../i18n/lang'
import { Section } from './Section'
import { Reveal } from './Reveal'
import { CheckIcon, CopyIcon } from './icons'
import './Install.css'

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // clipboard API can be unavailable (http, permissions) — fall back
    const area = document.createElement('textarea')
    area.value = text
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    let ok = false
    try {
      ok = document.execCommand('copy')
    } catch {
      ok = false
    }
    area.remove()
    return ok
  }
}

export function Install() {
  const { t } = useLang()
  const [copied, setCopied] = useState(false)
  const resetTimer = useRef<number>(0)

  useEffect(() => () => clearTimeout(resetTimer.current), [])

  const onCopy = async () => {
    if (await copyText(t.install.command)) {
      setCopied(true)
      clearTimeout(resetTimer.current)
      resetTimer.current = window.setTimeout(() => setCopied(false), 1800)
    }
  }

  return (
    <Section id="install" index="07" eyebrow={t.install.eyebrow} title={t.install.title} sub={t.install.sub}>
      <div className="install-col">
        <Reveal>
          <div className="term card">
            <div className="term-bar">
              <span className="term-dots" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              <span className="term-title">{t.install.terminalTitle}</span>
            </div>
            <div className="term-row">
              <code className="term-cmd">
                <span className="term-prompt" aria-hidden="true">
                  $
                </span>
                {t.install.command}
              </code>
              <button type="button" className={copied ? 'term-copy copied' : 'term-copy'} onClick={onCopy}>
                {copied ? <CheckIcon /> : <CopyIcon />}
                <span>{copied ? t.install.copied : t.install.copy}</span>
              </button>
            </div>
          </div>
          <p className="install-note" aria-live="polite">
            {t.install.commandNote}
          </p>
        </Reveal>

        <Reveal delay={90}>
          <ol className="install-steps">
            {t.install.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </Reveal>

        <Reveal delay={140}>
          <p className="install-badges">
            <span>{t.install.badges.mac}</span>
            <span>{t.install.badges.win}</span>
            <span>{t.install.badges.mit}</span>
            <span>{t.install.badges.npm}</span>
          </p>
        </Reveal>

        <Reveal delay={180}>
          <details className="install-source">
            <summary>{t.install.sourceSummary}</summary>
            <p className="install-source-note">{t.install.sourceNote}</p>
            {t.install.sourceCommands.map((command) => (
              <pre key={command} className="install-source-cmd">
                <code>{command}</code>
              </pre>
            ))}
          </details>
        </Reveal>
      </div>
    </Section>
  )
}

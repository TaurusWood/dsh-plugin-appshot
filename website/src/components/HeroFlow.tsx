import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useLang } from '../i18n/lang'
import { usePrefersReducedMotion } from '../lib/usePrefersReducedMotion'
import { CaptureBrackets } from './icons'
import windowCapture from '../assets/window-capture.jpg'
import './HeroFlow.css'

type Phase = 'idle' | 'press' | 'capture' | 'fly' | 'mounted'

/** Offset (ms) at which each phase starts inside one loop. */
const TIMELINE: Array<{ phase: Phase; at: number }> = [
  { phase: 'press', at: 1200 },
  { phase: 'capture', at: 1900 },
  { phase: 'fly', at: 2800 },
  { phase: 'mounted', at: 3600 },
]
/** When the loop snaps back to idle (and how long one full cycle takes). */
const RESET_AT = 8000
const LOOP_MS = 8800

const GHOST_W = 150
const GHOST_H = 89 // window-capture.jpg aspect ratio (3029 × 1792)

interface Flight {
  x1: number
  y1: number
  x2: number
  y2: number
  scale: number
}

function detectWindows(): boolean {
  return typeof navigator !== 'undefined' && /win/i.test(navigator.platform)
}

/**
 * The product story as a looping, self-running scene:
 * current window → global hotkey → capture brackets → thumbnail flies → composer draft.
 * The thumbnail flight is measured from the real DOM positions so it survives
 * every breakpoint; reduced-motion users get the calm end state instead.
 */
export function HeroFlow() {
  const { t } = useLang()
  const reducedMotion = usePrefersReducedMotion()
  const [phase, setPhase] = useState<Phase>('idle')
  const [flight, setFlight] = useState<Flight | null>(null)
  const [inView, setInView] = useState(true)

  const flowRef = useRef<HTMLDivElement>(null)
  const windowRef = useRef<HTMLDivElement>(null)
  const slotRef = useRef<HTMLDivElement>(null)

  // Run the loop only while the hero is actually on screen.
  useEffect(() => {
    const el = flowRef.current
    if (!el) return
    const observer = new IntersectionObserver((entries) => setInView(entries[0]?.isIntersecting ?? true))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (reducedMotion) {
      setPhase('mounted')
      return
    }
    if (!inView) return
    let timeouts: number[] = []
    const schedule = () => {
      setPhase('idle')
      for (const { phase: p, at } of TIMELINE) {
        timeouts.push(window.setTimeout(() => setPhase(p), at))
      }
      timeouts.push(window.setTimeout(() => setPhase('idle'), RESET_AT))
      timeouts.push(window.setTimeout(schedule, LOOP_MS))
    }
    schedule()
    return () => {
      for (const id of timeouts) clearTimeout(id)
      timeouts = []
    }
  }, [reducedMotion, inView])

  // Measure the flight path between the window card and the composer chip slot.
  // Observe the cards themselves (not just the fixed-height stage): the window
  // card grows when its screenshot finishes loading, invalidating earlier numbers.
  useLayoutEffect(() => {
    const compute = () => {
      const flow = flowRef.current
      const win = windowRef.current
      const slot = slotRef.current
      if (!flow || !win || !slot) return
      const f = flow.getBoundingClientRect()
      const w = win.getBoundingClientRect()
      const s = slot.getBoundingClientRect()
      setFlight({
        x1: w.left + w.width * 0.56 - f.left - GHOST_W / 2,
        y1: w.top + w.height * 0.38 - f.top - GHOST_H / 2,
        x2: s.left + s.width / 2 - f.left - GHOST_W / 2,
        y2: s.top + s.height / 2 - f.top - GHOST_H / 2,
        scale: Math.min((s.width / GHOST_W) * 1.05, 0.8),
      })
    }
    compute()
    const observer = new ResizeObserver(compute)
    for (const el of [flowRef.current, windowRef.current, slotRef.current]) {
      if (el) observer.observe(el)
    }
    window.addEventListener('resize', compute)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', compute)
    }
  }, [])

  const isWindows = detectWindows()
  const keyA = isWindows ? 'Ctrl' : '⌘'
  const keyB = isWindows ? 'Ctrl' : '⌘'
  const ghostFlying = phase === 'fly' || phase === 'mounted'
  const ghostVisible = phase === 'capture' || ghostFlying
  const chipMounted = phase === 'mounted'

  const ghostStyle = flight
    ? {
        width: GHOST_W,
        height: GHOST_H,
        transform: ghostFlying
          ? `translate(${flight.x2}px, ${flight.y2}px) scale(${flight.scale})`
          : `translate(${flight.x1}px, ${flight.y1}px)`,
      }
    : { opacity: 0 }

  return (
    <div className="flow" ref={flowRef} role="img" aria-label={t.hero.flowAria}>
      <div className="flow-stage" data-phase={phase}>
        <span className="flow-label flow-label-window">{t.hero.flowWindow}</span>

        <div className="flow-window" ref={windowRef} aria-hidden="true">
          <img src={windowCapture} alt="" draggable={false} />
          <CaptureBrackets className="flow-brackets" />
        </div>

        <div className="flow-hotkey" aria-hidden="true">
          <span className="flow-label">{t.hero.flowHotkey}</span>
          <span className="flow-keys">
            <span className="keycap">{keyA}</span>
            <span className="keycap-plus">+</span>
            <span className="keycap">{keyB}</span>
          </span>
        </div>

        <div className="flow-composer" aria-hidden="true">
          <span className="flow-label">{t.hero.flowComposer}</span>
          <div className="fc-card">
            <div className="fc-dots">
              <i />
              <i />
              <i />
            </div>
            <div className="fc-body">
              <div className="fc-slot" ref={slotRef}>
                <div className={chipMounted ? 'fc-chip in' : 'fc-chip'}>
                  <img src={windowCapture} alt="" draggable={false} />
                </div>
              </div>
              <div className={chipMounted ? 'fc-input focused' : 'fc-input'}>
                <span className="fc-placeholder">{t.hero.flowInput}</span>
                <span className="fc-caret" />
              </div>
              <div className="fc-toolbar">
                <span className="fc-plus">+</span>
                <span className="fc-send">
                  <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M8 13V3M4 7l4-4 4 4" />
                  </svg>
                </span>
              </div>
            </div>
          </div>
        </div>

        {flight !== null && (
          <img
            src={windowCapture}
            alt=""
            aria-hidden="true"
            className={ghostVisible ? 'flow-ghost visible' : 'flow-ghost'}
            style={ghostStyle}
            draggable={false}
          />
        )}
      </div>
    </div>
  )
}

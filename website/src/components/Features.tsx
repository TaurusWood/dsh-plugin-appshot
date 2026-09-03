import { useLang } from '../i18n/lang'
import { Section } from './Section'
import { Reveal } from './Reveal'
import { WindowsGlyph } from './icons'
import windowCapture from '../assets/window-capture.jpg'
import './Features.css'

export function Features() {
  const { t } = useLang()
  const f = t.features.tiles

  return (
    <Section id="features" index="04" eyebrow={t.features.eyebrow} title={t.features.title} sub={t.features.sub}>
      <div className="bento">
        <Reveal className="tile tile-draft">
          <h3 className="tile-title">{f.draft.title}</h3>
          <p className="tile-body">{f.draft.body}</p>
          <div className="tile-visual tile-draft-visual" aria-hidden="true">
            <span className="td-chip" />
            <span className="td-input">
              <i className="td-caret" />
            </span>
            <span className="td-send" />
          </div>
        </Reveal>

        <Reveal className="tile tile-hotkeys" delay={70}>
          <h3 className="tile-title">{f.hotkeys.title}</h3>
          <p className="tile-body">{f.hotkeys.body}</p>
          <div className="tile-visual tile-keys-visual" aria-hidden="true">
            <span className="tk-row">
              <span className="tk-os">macOS</span>
              <span className="keycap tk-key">⌘</span>
              <span className="keycap-plus">+</span>
              <span className="keycap tk-key">⌘</span>
            </span>
            <span className="tk-row">
              <span className="tk-os">Windows</span>
              <span className="keycap tk-key">Ctrl</span>
              <span className="keycap-plus">+</span>
              <span className="keycap tk-key">Ctrl</span>
            </span>
          </div>
        </Reveal>

        <Reveal className="tile tile-multishot">
          <h3 className="tile-title">{f.multishot.title}</h3>
          <p className="tile-body">{f.multishot.body}</p>
          <div className="tile-visual tile-stack-visual" aria-hidden="true">
            <span className="ts-card ts-back2" />
            <span className="ts-card ts-back1" />
            <span className="ts-card ts-front">
              <img src={windowCapture} alt="" loading="lazy" draggable={false} />
            </span>
          </div>
        </Reveal>

        <Reveal className="tile tile-native" delay={70}>
          <h3 className="tile-title">{f.native.title}</h3>
          <p className="tile-body">{f.native.body}</p>
          <div className="tile-visual tile-native-visual" aria-hidden="true">
            <span className="tn-row">
              <span className="tn-glyph">⌘</span>
              {f.native.macRow}
            </span>
            <span className="tn-row">
              <span className="tn-glyph">
                <WindowsGlyph size={13} />
              </span>
              {f.native.winRow}
            </span>
          </div>
        </Reveal>

        <Reveal className="tile tile-leftovers">
          <h3 className="tile-title">{f.leftovers.title}</h3>
          <p className="tile-body">{f.leftovers.body}</p>
          <code className="tile-code" aria-hidden="true">
            {f.leftovers.code}
          </code>
        </Reveal>

        <Reveal className="tile tile-feedback" delay={70}>
          <h3 className="tile-title">{f.feedback.title}</h3>
          <p className="tile-body">{f.feedback.body}</p>
        </Reveal>
      </div>
    </Section>
  )
}

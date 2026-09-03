import { useLang } from '../i18n/lang'
import { BrandMark } from './icons'
import './Footer.css'

const REPO = 'https://github.com/TaurusWood/dsh-plugin-appshot'

export function Footer() {
  const { t } = useLang()
  return (
    <footer className="site-footer">
      <div className="container footer-inner">
        <div className="footer-brand">
          <BrandMark size={18} className="footer-mark" />
          <span className="footer-name">Appshot</span>
          <span className="footer-made">{t.footer.madeFor}</span>
        </div>
        <nav className="footer-nav" aria-label="Footer">
          <a href={REPO} target="_blank" rel="noreferrer">
            GitHub
          </a>
          <a href={`${REPO}/issues`} target="_blank" rel="noreferrer">
            Issues
          </a>
          <a href={`${REPO}/releases`} target="_blank" rel="noreferrer">
            Releases
          </a>
          <a href="https://www.npmjs.com/package/dsh-plugin-appshot" target="_blank" rel="noreferrer">
            npm
          </a>
        </nav>
      </div>
      <div className="container footer-legal">
        <p>{t.footer.disclaimer}</p>
        <p>{t.footer.license}</p>
      </div>
    </footer>
  )
}

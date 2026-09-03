import { LangProvider } from './i18n/lang'
import { Header } from './components/Header'
import { Hero } from './components/Hero'
import { Workflow } from './components/Workflow'
import { HowItWorks } from './components/HowItWorks'
import { PreciseCapture } from './components/PreciseCapture'
import { Features } from './components/Features'
import { Platforms } from './components/Platforms'
import { Architecture } from './components/Architecture'
import { Install } from './components/Install'
import { Cta } from './components/Cta'
import { Footer } from './components/Footer'

export default function App() {
  return (
    <LangProvider>
      <Header />
      <main>
        <Hero />
        <Workflow />
        <HowItWorks />
        <PreciseCapture />
        <Features />
        <Platforms />
        <Architecture />
        <Install />
        <Cta />
      </main>
      <Footer />
    </LangProvider>
  )
}

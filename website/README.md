# Appshot Website

The product landing page for `dsh-plugin-appshot`, fully isolated from the plugin
package at the repository root.

## Stack

- Vite + React 18 + TypeScript, strict mode, no UI framework, no animation library.
- Plain CSS with design tokens (`src/styles/tokens.css`); component-scoped stylesheets
  co-located with their components.
- Self-hosted variable fonts via `@fontsource-variable` (Inter + JetBrains Mono);
  CJK text falls back to the system stack (PingFang SC / Microsoft YaHei).
- Bilingual (EN / 中文) from a single dictionary: `src/i18n/dict.ts`. The `zh` locale
  is typed as `Dict`, so the two locales cannot drift structurally. Language choice is
  detected from the browser on first visit, persisted in `localStorage`
  (`appshot-lang`), and updates `document.lang` / title / meta description on switch.

## Commands

```sh
pnpm install   # isolated workspace root — never touches the repo root install
pnpm dev       # dev server
pnpm build     # tsc + vite build → dist/ (base './', works on any static subpath)
pnpm preview   # serve the production build
```

## Assets

- `src/assets/*.jpg` are crops of the real product screenshots in `docs/assets/`
  (Chrome window from `before-double-command.png`, DSH desktop from
  `after-double-command.png`, lightbox from `open-app-shot-in-dsh-desktop.png`).
  They are presentation crops only — the product UI inside them is untouched.
- `public/og.png` is the 1200×630 social card; `public/favicon.svg` is the
  capture-brackets mark.

## Notes

- `pnpm-workspace.yaml` in this directory makes `website/` its own workspace root so
  dependency installs never interfere with the plugin's `pnpm-workspace.yaml` at the
  repository root.
- `og:image` / `twitter:image` in `index.html` are intentionally relative; replace
  with an absolute URL if the site gets a fixed deployment domain.
- Animations respect `prefers-reduced-motion`; the hero capture loop also pauses
  while off-screen.

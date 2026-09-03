interface IconProps {
  size?: number
  className?: string
}

export function GitHubIcon({ size = 18, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  )
}

export function CopyIcon({ size = 15, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.8" />
      <path d="M10.5 3.5v-.7A1.8 1.8 0 0 0 8.7 1H3.3A1.8 1.8 0 0 0 1.5 2.8v5.4A1.8 1.8 0 0 0 3.3 10h.7" />
    </svg>
  )
}

export function CheckIcon({ size = 15, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <path d="m2.5 8.5 3.5 3.5 7.5-8" />
    </svg>
  )
}

export function ArrowRightIcon({ size = 14, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <path d="M2.5 8h11M9.5 4l4 4-4 4" />
    </svg>
  )
}

export function MenuIcon({ size = 18, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true" className={className}>
      <path d="M2 4.5h12M2 11.5h12" />
    </svg>
  )
}

export function CloseIcon({ size = 18, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true" className={className}>
      <path d="m3.5 3.5 9 9M12.5 3.5l-9 9" />
    </svg>
  )
}

/** Four-pane window glyph used as the Windows platform mark. */
export function WindowsGlyph({ size = 15, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M1.5 2.9 7.2 2v5.4H1.5V2.9ZM8.1 1.9 14.5 1v6.4H8.1V1.9ZM1.5 8.6h5.7V14L1.5 13.1V8.6ZM8.1 8.6h6.4V15L8.1 14.1V8.6Z" />
    </svg>
  )
}

/**
 * Capture-bracket overlay that fills its positioned parent. CSS corners keep a
 * constant radius and stroke at any size, unlike a stretched viewBox.
 */
export function CaptureBrackets({ className }: IconProps) {
  return (
    <span className={className ? `capture-brackets ${className}` : 'capture-brackets'} aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
    </span>
  )
}

/** Viewfinder brand mark: capture brackets around a window. */
export function BrandMark({ size = 22, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" className={className}>
      <g fill="none" stroke="var(--accent)" strokeWidth="6" strokeLinecap="round">
        <path d="M13 27v-8a6 6 0 0 1 6-6h8" />
        <path d="M37 13h8a6 6 0 0 1 6 6v8" />
        <path d="M51 37v8a6 6 0 0 1-6 6h-8" />
        <path d="M27 51h-8a6 6 0 0 1-6-6v-8" />
      </g>
      <rect x="23" y="23" width="18" height="18" rx="3.5" fill="currentColor" />
    </svg>
  )
}

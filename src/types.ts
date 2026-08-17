export type ImageMediaType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'

export interface ImageAttachmentRef {
  attachmentId: string
  mediaType: ImageMediaType
  bytes: number
  width: number
  height: number
  name?: string
}

export interface SaveImageInput {
  data: Uint8Array
  mediaType: ImageMediaType
  name?: string
}

export interface AppshotEventReady {
  type: 'ready'
  version: number
  pid?: number
  bundleId?: string
}

export interface AppshotEventCapture {
  type: 'appshot'
  id?: string
  platform?: string
  appName: string
  windowTitle?: string
  windowId?: number
  width?: number
  height?: number
  mimeType?: string
  imagePath: string
  timestamp?: number
}

export interface AppshotConfig {
  shortcutMode?: 'double-cmd' | 'double-option' | 'double-control' | 'cmd-option'
  soundEnabled?: boolean
  animationEnabled?: boolean
}

export interface AppshotEventError {
  type: 'error'
  id?: string
  code: string
  message: string
}

export type AppshotEvent = AppshotEventReady | AppshotEventCapture | AppshotEventError

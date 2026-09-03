/**
 * Single source of truth for every string on the site, in both languages.
 * `zh` is typed as `Dict` so the two locales can never drift structurally.
 */

const en = {
  meta: {
    title: 'Appshot — Window context capture for DeepSeek Harness',
    description:
      'Appshot is a global-hotkey plugin for DeepSeek Harness: one press captures the window you are working in and mounts it into the composer as agent context. macOS 14+ and Windows 10 19041+, MIT open source.',
  },

  nav: {
    features: 'Features',
    how: 'How it works',
    install: 'Install',
    github: 'GitHub',
    openMenu: 'Open menu',
    closeMenu: 'Close menu',
    switchLang: 'Switch language',
    tagline: 'for DeepSeek Harness',
  },

  hero: {
    eyebrow: 'DeepSeek Harness plugin · a DSH take on Codex Appshots',
    titleA: 'Capture the window.',
    titleB: 'Keep the flow.',
    sub: 'Appshot turns the window you are working in into agent context. One global hotkey captures the frontmost window and drops it straight into the DeepSeek Harness composer — no saving, no switching, no uploading.',
    ctaInstall: 'Install Appshot',
    ctaGithub: 'View on GitHub',
    platforms: 'macOS 14+',
    platformsWin: 'Windows 10 19041+',
    license: 'MIT open source',
    flowLabel: 'How a capture travels',
    flowWindow: 'Your current window',
    flowHotkey: 'Global hotkey',
    flowComposer: 'DSH Composer',
    flowChip: 'Window capture',
    flowInput: 'Ask the agent about this window…',
    flowAria:
      'Illustration: the current app window is captured with a global hotkey and lands as an attachment in the DSH composer draft.',
  },

  workflow: {
    eyebrow: 'Why',
    title: 'Less switching, more asking',
    sub: 'The screenshot was never the hard part — the five app switches around it were.',
    oldTitle: 'The usual loop',
    oldSteps: ['Take a screenshot', 'Switch apps', 'Find & upload the image', 'Re-explain the context'],
    newTitle: 'With Appshot',
    newSteps: ['Press the hotkey', 'Ask'],
    note: 'From seeing something to asking about it, nothing in between — the window in front of you is already in the conversation.',
  },

  how: {
    eyebrow: 'How it works',
    title: 'From window to composer in one press',
    sub: 'No capture UI, no export dialog. Appshot lives in the background and acts the moment you call it.',
    steps: [
      {
        title: 'Stay in your app',
        body: 'Browser, IDE, terminal, documents — keep working wherever you are. The native agent listens system-wide while DSH sits in the background.',
      },
      {
        title: 'Press the global shortcut',
        body: 'Left ⌘ + right ⌘ on macOS, left Ctrl + right Ctrl on Windows — remappable in the DSH settings panel.',
      },
      {
        title: 'The window lands in Composer',
        body: 'The capture mounts into the current session’s draft. Add a question, append more shots, or delete it — nothing is sent until you send it.',
      },
    ],
    visualCaption: 'The capture lands in the composer draft — click it any time to inspect the full-resolution shot.',
    visualAlt: 'DeepSeek Harness desktop with the captured window mounted in the composer draft',
  },

  precise: {
    eyebrow: 'Precise capture',
    title: 'The window you are in — not the whole desktop',
    sub: 'Appshot captures only the frontmost window at the moment you trigger. No cropping, no cleanup afterwards.',
    yesTitle: 'Captured',
    yes: [
      'The one window you are working in',
      'On macOS: via ScreenCaptureKit, Retina-sharp, shadows and tooltips filtered',
      'On Windows: the topmost window on the monitor under your cursor',
    ],
    noTitle: 'Never captured',
    no: [
      'The full screen or wallpaper',
      'Other windows and background apps',
      'Menu bar, Dock or taskbar',
      'DSH itself — self-capture is refused by design',
    ],
    desktopLabel: 'Your desktop',
    capturedLabel: 'captured',
    ignoredLabel: 'left alone',
  },

  features: {
    eyebrow: 'Capabilities',
    title: 'Built for the flow',
    sub: 'Every detail serves one goal: from noticing something to asking about it, without leaving your work.',
    tiles: {
      draft: {
        title: 'Draft, not auto-send',
        body: 'Captures mount into the composer draft of the current session. Preview, append or delete — the message only moves when you hit send.',
      },
      hotkeys: {
        title: 'Global native hotkeys',
        body: 'A system-wide state machine with cooldown, responding even when DSH is minimized. Defaults are remappable in the settings panel.',
      },
      multishot: {
        title: 'Multi-shot context',
        body: 'Trigger again to append more captures — assemble a small set of windows before you ask.',
      },
      native: {
        title: 'Native to the core',
        body: 'Swift and ScreenCaptureKit on macOS, C# and Win32 on Windows. Both agents ship prebuilt inside the npm package; the host plugin carries zero runtime dependencies.',
        macRow: 'macOS · Swift · ScreenCaptureKit',
        winRow: 'Windows · C# · Win32',
      },
      leftovers: {
        title: 'Nothing left behind',
        body: 'Staging files follow a single-owner contract — cleaned on every success and failure path, with orphan sweeps on startup.',
        code: 'finally { await unlink(staging) }',
      },
      feedback: {
        title: 'Quiet, deliberate feedback',
        body: 'macOS guides you through permissions on first run. Windows answers with a shutter sound, a border flash and a taskbar fly-in — each optional; failures appear as toasts that never steal focus.',
      },
    },
  },

  platforms: {
    eyebrow: 'Platform experience',
    title: 'Two platforms, each genuinely native',
    sub: 'Appshot does not paste one UX onto both systems. The trigger is the same idea; the delivery is engineered per platform.',
    mac: {
      name: 'macOS 14+',
      keysA: '⌘',
      keysB: '⌘',
      keysLabel: 'left + right Command',
      points: [
        'Capture-then-activate: DSH comes to front only after the shot is safely on disk — it can never capture itself.',
        'ScreenCaptureKit capture filters transparent layers, shadows and tooltips, keeping full Retina resolution.',
        'First trigger walks you through Screen Recording and Accessibility permissions.',
        'Under dsh web the shot still lands in the composer — only the window activation is skipped.',
      ],
      beforeLabel: 'Before — working in your current app',
      afterLabel: 'After — DSH focused, capture in the draft',
      tags: ['ScreenCaptureKit', 'NDJSON IPC', 'SSE push', 'Appshot Agent.app'],
    },
    win: {
      name: 'Windows 10 19041+',
      keysA: 'Ctrl',
      keysB: 'Ctrl',
      keysLabel: 'left + right Ctrl',
      points: [
        'Silent delivery: DSH is never activated or focused — the capture lands while you keep working.',
        'Targets the topmost window on the monitor under your cursor; refuses DSH, desktop or taskbar instead of guessing.',
        'Two-stage capture keeps a visible-content backup, so what you saw is what you got.',
        'Shutter sound, border flash and thumbnail fly-in are each optional; failures surface as no-focus toasts.',
      ],
      silentBadge: 'silent delivery',
      tags: ['Win32 hook', 'GDI two-stage', 'self-contained exe'],
    },
  },

  architecture: {
    eyebrow: 'Under the hood',
    title: 'Three pieces, one-way data flow',
    sub: 'A native agent, a host plugin and a client module — each with a single job, connected by small explicit contracts.',
    nodes: [
      { name: 'Native Agent', lines: ['Swift · Appshot Agent.app', 'C# · single-file exe'] },
      { name: 'Host Plugin', lines: ['Node · Cordis', 'fs bytes → Attachment'] },
      { name: 'Client Module', lines: ['DSH Renderer', 'resolves active session'] },
      { name: 'Composer', lines: ['Draft', 'mounted, not sent'] },
    ],
    transports: {
      mac: 'macOS · NDJSON over stdio → saveImage → SSE push',
      win: 'Windows · in-memory pending → HTTP long-poll → MOUNTED ack',
    },
    principles: [
      {
        title: 'No self-capture',
        body: 'Nothing may raise, show or focus the DSH window before the screenshot is on disk. The rule is enforced in the agent, not left to timing.',
      },
      {
        title: 'Single owner',
        body: 'Every staging byte has exactly one owner at any moment — plugin, AttachmentStore or composer draft — and none of the paths leave two.',
      },
    ],
    docsLink: 'Read the full docs on GitHub',
  },

  install: {
    eyebrow: 'Install',
    title: 'One command, prebuilt for both platforms',
    sub: 'The npm package ships the host plugin, the client module and both native agents prebuilt — no local compilation, no build approval.',
    terminalTitle: 'Terminal',
    command: 'dsh plugin --profile web add dsh-plugin-appshot',
    commandNote: 'Replace “web” with the name of your DSH profile.',
    copy: 'Copy command',
    copied: 'Copied',
    steps: [
      'Restart dsh — you are ready when the log shows “plugin applied successfully” and “native agent ready”.',
      'macOS asks for Screen Recording and Accessibility on first capture; Windows needs no extra grants.',
    ],
    badges: {
      mac: 'macOS 14+',
      win: 'Windows 10 19041+',
      mit: 'MIT license',
      npm: 'Prebuilt on npm',
    },
    sourceSummary: 'Install from source (developers)',
    sourceNote: 'Run inside the plugin directory, then add it from its parent directory:',
    sourceCommands: ['pnpm install && pnpm build && pnpm build:native', 'dsh plugin --profile <name> add ./dsh-plugin-appshot'],
  },

  cta: {
    title: 'Built for DeepSeek Harness. Open source.',
    sub: 'Appshot is an independent, MIT-licensed project — read the source, file issues, or fork it into your own harness workflow.',
    primary: 'View source on GitHub',
    secondary: 'Browse issues',
    links: {
      readme: 'README',
      readmeZh: 'README (中文)',
      npm: 'npm package',
      changelog: 'Changelog',
    },
  },

  footer: {
    disclaimer:
      'An independent open-source project, not affiliated with DeepSeek or OpenAI. Inspired by the Codex Appshots concept.',
    license: 'v0.4.1 · MIT License',
    madeFor: 'A DSH take on Codex Appshots',
  },
}

export type Dict = typeof en
export type Lang = 'en' | 'zh'

const zh: Dict = {
  meta: {
    title: 'Appshot · 把当前窗口一键交给 Agent — DeepSeek Harness 插件',
    description:
      'Appshot 是 DeepSeek Harness 的全局快捷键截图插件：按下快捷键，当前前台窗口即刻截图并挂入 Composer，成为 Agent 上下文。支持 macOS 14+ 与 Windows 10 19041+，MIT 开源。',
  },

  nav: {
    features: '功能',
    how: '工作方式',
    install: '安装',
    github: 'GitHub',
    openMenu: '打开菜单',
    closeMenu: '关闭菜单',
    switchLang: '切换语言',
    tagline: 'DeepSeek Harness 插件',
  },

  hero: {
    eyebrow: 'DeepSeek Harness 插件 · DSH 版 Codex Appshots',
    titleA: '把眼前的窗口，',
    titleB: '直接交给 Agent',
    sub: 'Appshot 让你正在操作的窗口一键成为 Agent 上下文：一个全局快捷键截取当前前台窗口，自动挂入 DeepSeek Harness 的 Composer——无需保存、无需切换、无需上传。',
    ctaInstall: '安装 Appshot',
    ctaGithub: '在 GitHub 查看',
    platforms: 'macOS 14+',
    platformsWin: 'Windows 10 19041+',
    license: 'MIT 开源',
    flowLabel: '一次截图的旅程',
    flowWindow: '你正在使用的窗口',
    flowHotkey: '全局快捷键',
    flowComposer: 'DSH Composer',
    flowChip: '窗口截图',
    flowInput: '就这个窗口，向 Agent 提问…',
    flowAria: '示意图：全局快捷键截取当前应用窗口，截图作为附件落入 DSH Composer 草稿。',
  },

  workflow: {
    eyebrow: '为什么',
    title: '少一些切换，多一些提问',
    sub: '难的从来不是截图，而是截图前后那几次应用切换。',
    oldTitle: '传统流程',
    oldSteps: ['手动截图', '切换应用', '找到图片并上传', '重新解释上下文'],
    newTitle: '使用 Appshot',
    newSteps: ['按下快捷键', '直接提问'],
    note: '从「看到」到「问出」，中间不再有任何步骤——你眼前的窗口，已经在对话语境里。',
  },

  how: {
    eyebrow: '工作方式',
    title: '一次按键，窗口进入 Composer',
    sub: '没有截图界面，没有导出对话框。Appshot 常驻后台，在你呼招的瞬间行动。',
    steps: [
      {
        title: '留在当前应用',
        body: '浏览器、IDE、终端、文档……在哪里工作都可以。Native Agent 系统级监听，DSH 安静地待在后台。',
      },
      {
        title: '按下全局快捷键',
        body: 'macOS 默认左 ⌘ + 右 ⌘，Windows 默认左 Ctrl + 右 Ctrl，均可在 DSH 设置面板自定义。',
      },
      {
        title: '窗口落入 Composer',
        body: '截图挂入当前会话的输入草稿：补一句提问、追加更多截图、或直接删掉——按下发送前，什么都不会发生。',
      },
    ],
    visualCaption: '截图挂入 Composer 草稿，随时点击可查看完整大图。',
    visualAlt: 'DeepSeek Harness 桌面端，截图已挂入 Composer 草稿',
  },

  precise: {
    eyebrow: '精准捕获',
    title: '只截眼前的窗口，不是整个桌面',
    sub: 'Appshot 只截取触发瞬间的前台窗口，所见即所得，无需事后裁剪。',
    yesTitle: '会截取',
    yes: [
      '正在操作的这一个窗口',
      'macOS：经 ScreenCaptureKit 捕获，保留 Retina 分辨率，过滤阴影与 Tooltip',
      'Windows：截取鼠标所在显示器的最前窗口',
    ],
    noTitle: '不会截取',
    no: [
      '整个屏幕或桌面壁纸',
      '其他窗口与后台应用',
      '菜单栏、Dock 或任务栏',
      'DSH 自己——按设计拒绝自截',
    ],
    desktopLabel: '你的桌面',
    capturedLabel: '已捕获',
    ignoredLabel: '保持原样',
  },

  features: {
    eyebrow: '能力',
    title: '为工作流而生',
    sub: '所有细节只为一个目标：从注意到问题到提出问题，不离开手头的工作。',
    tiles: {
      draft: {
        title: '进草稿，不自动发送',
        body: '截图挂入当前会话的 Composer 草稿：预览、追加或删除都由你决定——按下发送前，不会触发任何东西。',
      },
      hotkeys: {
        title: '全局原生快捷键',
        body: '系统级状态机 + 冷却防抖，DSH 最小化时同样响应；默认组合可在设置面板更改。',
      },
      multishot: {
        title: '多图上下文',
        body: '连续触发即可追加多张截图，提问前凑齐一组相关窗口。',
      },
      native: {
        title: '原生双端实现',
        body: 'macOS 用 Swift + ScreenCaptureKit，Windows 用 C# + Win32；双端 Agent 随 npm 包预构建分发，宿主插件零运行时依赖。',
        macRow: 'macOS · Swift · ScreenCaptureKit',
        winRow: 'Windows · C# · Win32',
      },
      leftovers: {
        title: '不留残余',
        body: 'Staging 临时文件遵循单一 Owner 合同——所有成功与失败分支都会清理，启动时自动清扫孤儿文件。',
        code: 'finally { await unlink(staging) }',
      },
      feedback: {
        title: '克制的反馈',
        body: 'macOS 首次运行引导授权；Windows 以快门音、边框闪烁与缩略图飞入回应成功（均可关闭），失败提示永不抢占焦点。',
      },
    },
  },

  platforms: {
    eyebrow: '平台体验',
    title: '两个平台，各自的原生体验',
    sub: 'Appshot 没有把同一套 UX 复制到两个系统：触发是同一个理念，交付则按平台分别设计。',
    mac: {
      name: 'macOS 14+',
      keysA: '⌘',
      keysB: '⌘',
      keysLabel: '左 ⌘ + 右 ⌘',
      points: [
        '先截后唤：截图安全落盘后 DSH 才被唤起置顶，绝不会截到自己。',
        'ScreenCaptureKit 过滤透明层、阴影与 Tooltip，保留完整 Retina 分辨率。',
        '首次触发引导授予「屏幕录制」与「辅助功能」权限。',
        'dsh web 下截图仍会挂入 Composer，只是不唤起窗口。',
      ],
      beforeLabel: '触发前——正在当前应用中工作',
      afterLabel: '触发后——DSH 已聚焦，截图进入草稿',
      tags: ['ScreenCaptureKit', 'NDJSON IPC', 'SSE 推送', 'Appshot Agent.app'],
    },
    win: {
      name: 'Windows 10 19041+',
      keysA: 'Ctrl',
      keysB: 'Ctrl',
      keysLabel: '左 Ctrl + 右 Ctrl',
      points: [
        '静默交付：全程不激活、不聚焦 DSH，截图进入会话的同时不打断手头工作。',
        '锁定鼠标所在显示器的最前窗口；目标是 DSH、桌面或任务栏时明确拒绝，绝不误截。',
        '置前 + 降级两阶段截图，先留存可见内容备份，保证所见即所得。',
        '快门音、边框闪烁与缩略图飞入均可关闭；失败提示为不抢焦点的轻量浮层。',
      ],
      silentBadge: '静默交付',
      tags: ['Win32 键盘钩子', 'GDI 双阶段截图', '自包含单文件 exe'],
    },
  },

  architecture: {
    eyebrow: '内部实现',
    title: '三个组件，单向数据流',
    sub: 'Native Agent、宿主插件与客户端模块各司其职，靠小而明确的契约连接。',
    nodes: [
      { name: 'Native Agent', lines: ['Swift · Appshot Agent.app', 'C# · 单文件 exe'] },
      { name: '宿主插件', lines: ['Node · Cordis', 'fs 字节 → Attachment'] },
      { name: '客户端模块', lines: ['DSH Renderer', '识别活跃会话'] },
      { name: 'Composer', lines: ['草稿', '挂载，不发送'] },
    ],
    transports: {
      mac: 'macOS · NDJSON stdio → saveImage → SSE 推送',
      win: 'Windows · 内存 Pending → HTTP 长轮询 → MOUNTED 确认',
    },
    principles: [
      {
        title: '防自截',
        body: '截图落盘之前，任何模块都不得唤起、显示或聚焦 DSH 窗口。这条规则由 Agent 强制执行，不靠时序运气。',
      },
      {
        title: '单一 Owner',
        body: '每一份 Staging 数据在任意时刻只有一个 Owner——插件、AttachmentStore 或 Composer 草稿——任何路径都不会留下两份。',
      },
    ],
    docsLink: '在 GitHub 阅读完整文档',
  },

  install: {
    eyebrow: '安装',
    title: '一条命令，双平台预构建',
    sub: 'npm 包内含宿主插件、客户端模块与双平台 Native Agent 预构建产物——无需本地编译，无需构建授权。',
    terminalTitle: '终端',
    command: 'dsh plugin --profile web add dsh-plugin-appshot',
    commandNote: '把「web」换成你的 DSH profile 名称。',
    copy: '复制命令',
    copied: '已复制',
    steps: [
      '重启 dsh——日志出现「plugin applied successfully」与「native agent ready」即加载成功。',
      'macOS 首次截图会引导授予屏幕录制与辅助功能权限；Windows 无需额外授权。',
    ],
    badges: {
      mac: 'macOS 14+',
      win: 'Windows 10 19041+',
      mit: 'MIT 许可证',
      npm: 'npm 预构建',
    },
    sourceSummary: '从源码安装（开发者）',
    sourceNote: '在插件目录内执行构建，然后回到插件父目录添加：',
    sourceCommands: ['pnpm install && pnpm build && pnpm build:native', 'dsh plugin --profile <name> add ./dsh-plugin-appshot'],
  },

  cta: {
    title: '为 DeepSeek Harness 而建，开源开放。',
    sub: 'Appshot 是独立的 MIT 开源项目——欢迎阅读源码、提交 Issue，或把它 fork 进你自己的 Harness 工作流。',
    primary: '在 GitHub 查看源码',
    secondary: '浏览 Issues',
    links: {
      readme: 'README',
      readmeZh: 'README（中文）',
      npm: 'npm 包',
      changelog: '更新日志',
    },
  },

  footer: {
    disclaimer: '独立开源项目，与 DeepSeek、OpenAI 无隶属关系；灵感来自 Codex Appshots。',
    license: 'v0.4.1 · MIT 许可证',
    madeFor: 'DSH 版 Codex Appshots',
  },
}

export const dicts: Record<Lang, Dict> = { en, zh }

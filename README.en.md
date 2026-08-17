# dsh-plugin-appshot

> A macOS global-hotkey "one-shot screenshot of the **current window**" that drops the image into the DeepSeek Harness (DSH) composer as context — hand your current working window to the agent with zero friction.

[English](README.en.md) · [中文](README.md) · [Changelog](CHANGELOG.md) · [更新日志](CHANGELOG.zh-CN.md)

![macOS](https://img.shields.io/badge/macOS-14%2B-333333?logo=apple&logoColor=white)
![Windows](https://img.shields.io/badge/Windows-WIP-9cf)
![DSH](https://img.shields.io/badge/DeepSeek%20Harness-0.1.0--rc.6-4f46e5)
![npm](https://img.shields.io/npm/v/dsh-plugin-appshot)
![License](https://img.shields.io/badge/license-MIT-green)

## Install (one command)

```sh
dsh plugin --profile web add dsh-plugin-appshot
```

- The npm package ships **prebuilt artifacts** — host plugin + client module + Native Agent bundled together; **no local compilation, no build approval** needed.
- **Restart dsh** after installing; you're ready when the startup log shows `[dsh-plugin-appshot] plugin applied successfully` and `native agent ready`.
- On first trigger, macOS will ask for two permissions: **Screen Recording** and **Accessibility** (see [Permissions](#permissions)).

> Installing from source (developers/contributors): run `pnpm install && pnpm build && pnpm build:native` inside the plugin directory, then run `dsh plugin --profile <name> add ./dsh-plugin-appshot` from its **parent** directory (`dsh plugin add` resolves relative paths against the invoking directory).

## What it is

A DSH take on "[Codex Appshots](https://developers.openai.com/codex/appshots)": brings global-shortcut context capture to DeepSeek Harness.

**Typical scenario**: whenever you run into an issue or question in any app or window — whether inspecting a design, browsing docs, debugging code in your IDE, or troubleshooting terminal output — simply press **Left ⌘ + Right ⌘**. The screenshot of your current window is instantly transferred to the DSH client and attached to the composer draft; just type your question to ask the agent directly, eliminating the friction of manual capturing, app switching, and pasting.

**It captures the "current window", not the "whole screen"** — matching Codex's own Appshots wording (*"An appshot captures the frontmost window only."*):

| ✅ Captures | ❌ Does not capture |
| --- | --- |
| The **one** frontmost window at the moment you trigger (Chrome / VS Code / Finder / Terminal…) | The whole screen, desktop wallpaper, menu bar/Dock, other windows, background apps |

```text
Press Left ⌘ + Right ⌘  →  capture frontmost window  →  image lands in composer  →  describe and Send
```

Currently supports **macOS 14+**; a **Windows version is in development**.

## Usage

1. In any app (Chrome, VS Code, Finder, Terminal…), **press Left ⌘ and Right ⌘ together** — you capture exactly the **one window** in front of you, not the whole screen.
2. After the screenshot lands on disk, the DSH window is activated and focused (capture-then-activate — DSH can never appear in its own screenshot; window activation applies to the DSH desktop app only — under `dsh web` the image still lands in the composer, just without the window activation).

| Before trigger (frontmost app window) | After trigger (captured & mounted into Composer) |
| :---: | :---: |
| ![Before trigger](docs/assets/before-double-command.png) | ![After trigger](docs/assets/after-double-command.png) |

3. The screenshot is attached to the current session's composer draft (click to inspect in full view, or trigger again to append more).

![Open Appshot in DSH Desktop](docs/assets/open-app-shot-in-dsh-desktop.png)

4. Type a description (e.g. "analyze this error on screen") and hit Send — the screenshot is submitted together with your text.

> The screenshot enters the composer rather than firing the agent directly — you stay in control: add context, append more shots, or remove attachments you don't need.

## Features

- **Global double-Command hotkey**: Left ⌘ + Right ⌘ state machine (the same trigger Codex Appshots uses), with a 1s debounce/cooldown; responds even while DSH is in the background or minimized.
- **Precise single-window capture**: only the frontmost window itself (transparent layers, shadows and tooltips filtered out), built on ScreenCaptureKit, Retina resolution preserved; on multi-display setups only the target window's screen is captured.
- **Capture-then-activate (no self-capture)**: the DSH window is activated and brought to front only after the screenshot has been taken and written to disk — no race condition that could "screenshot DSH itself".
- **Automatic composer mounting**: the host persists the screenshot as a DSH Attachment, pushes it over a self-hosted SSE channel, and the client module mounts it into the active session's composer draft and focuses the input.
- **Append multiple shots**: trigger repeatedly to stack several screenshots in one draft.
- **Permission feedback**: missing Screen Recording / Accessibility permissions trigger the system authorization prompt, plus a system notification (`UNUserNotificationCenter`) with the failure reason.
- **No leftovers**: staging temp files are deleted immediately after `saveImage` succeeds; orphan files from crashed runs are cleaned up on plugin startup.

## How it works

Three components, one-way data flow:

```text
┌──────────────────────────┐     NDJSON IPC (stdio)     ┌───────────────────────────┐
│  macOS Native Agent       │ ────────────────────────▶  │  Node / Cordis host plugin │
│  (Appshot Agent.app)      │    type: "appshot"         │  (src/)                    │
│  · Double-Command FSM     │                            │  · fs.readFile bytes        │
│  · Frontmost-window pick  │                            │  · attachments.saveImage    │
│  · ScreenCaptureKit shot  │                            │  · ownership transfer+unlink│
│  · activate DSH after     │                            │  · webServer SSE broadcast  │
└──────────────────────────┘                            └─────────────┬─────────────┘
                                                                      │ SSE (appshot/ready)
                                                                      ▼
┌──────────────────────────┐
│  DSH Client module (Renderer) │
│  · resolve active sessionId   │
│  · mount ImageAttachmentRef   │
│  · focus composer input       │
└──────────────────────────┘
```

Key design points:

- **No-self-capture hard constraint**: no module may activate/show/focus the DSH window before the screenshot is on disk; window activation is a native capability (`NSRunningApplication`), not a DSH API.
- **Deterministic ownership transfer (Single Owner)**: the staging file belongs to the plugin until `saveImage` succeeds; ownership then moves to the DSH AttachmentStore and the plugin `unlink`s immediately; failure paths clean up in `finally`; orphan files are garbage-collected on startup.

## Permissions

On first trigger, macOS prompts for authorization:

| Permission | Purpose |
| --- | --- |
| **Screen Recording** | ScreenCaptureKit captures the frontmost window |
| **Accessibility** | Global hotkey state machine + window activation/bring-to-front |

If you deny, the capture is aborted with a system notification; re-grant in System Settings → Privacy & Security and retry.

## Limitations

- Currently **macOS 14+ only**; a **Windows version is in development** (planned on Win32 / Windows.Graphics.Capture); WebUI is not supported (a browser sandbox can't access global hotkeys or cross-app activation).
- Window activation applies to the DSH desktop app (macOS) only; under `dsh web` screenshots still land in the composer, but the window is not activated/brought to front.
- No region selection, full-screen capture, image annotation, OCR, or screenshot history (all on the roadmap).
- The hotkey is fixed to double-Command; no visual configuration panel yet.

## Development

```text
src/                 Host plugin (Cordis apply(ctx) entry + agent/ingest/sse/staging/ipc/client modules)
native/macos/        Swift Native Agent (ScreenCaptureKit + double-Command state machine)
docs/                requirements.md (PRD) / technical.md (design) / tasks.md (phase acceptance)
tests/               Phase contract tests (node --test)
```

Common commands:

```sh
pnpm build          # esbuild bundle host plugin + client module → dist/
pnpm typecheck      # tsc --noEmit
pnpm test           # contract tests (DSH_DISABLE_AGENT_SPAWN=1 to avoid spawning the real agent)
pnpm build:native   # build Appshot Agent.app

# Native diagnostics (inside native/macos)
swift build && .build/debug/appshot-macos --list-windows          # list capturable windows
.build/debug/appshot-macos --cli-capture --output /tmp/test.png    # frontmost-window capture PoC
```

Dependency notes: `@deepseek-ai/dsh-tools` and `@deepseek-ai/cordis` are peerDependencies (provided by the host; `import type` only — `ctx` is injected at runtime); versions stay pinned to the `0.1.0-rc.6` line (npm `latest` is a stale 0.0.1-rc.1 — don't `npm i` over it).

Publishing: `pnpm publish` (`prepack` automatically runs `pnpm build && pnpm build:native`; the artifact contains `dist`, `cordis.patch.yml` and the prebuilt `Appshot Agent.app`, so users install without any build approval).

## License

This project is licensed under the [MIT License](LICENSE).

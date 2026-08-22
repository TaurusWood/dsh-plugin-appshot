# Changelog

[English](./CHANGELOG.md) | [简体中文](./CHANGELOG.zh-CN.md)

# [0.3.0](https://github.com/TaurusWood/dsh-plugin-appshot/compare/v0.2.0...v0.3.0) (2026-08-22)


### Bug Fixes

* **client:** make settings panel follow DSH light/dark theme ([2e99fa0](https://github.com/TaurusWood/dsh-plugin-appshot/commit/2e99fa0643789cb92fbd122f674bc012c6a49f1f))
* **packaging:** ship windows agent in npm package with dual-runner release ([e0824d4](https://github.com/TaurusWood/dsh-plugin-appshot/commit/e0824d4a7976ecbaf0798f56b447fb35af003e17))
* **windows:** accept empty targetSessionId for NO_SESSION ACK ([db08b02](https://github.com/TaurusWood/dsh-plugin-appshot/commit/db08b024c43a208b8b7bf41d9933f68628352997))
* **windows:** add PENDING_ACK timeout guard to unstick delivery ([d1c68e6](https://github.com/TaurusWood/dsh-plugin-appshot/commit/d1c68e6cdcc514389c02378a4be1eab4b23daf6b))
* **windows:** capture flash window was fully transparent ([bc87ec2](https://github.com/TaurusWood/dsh-plugin-appshot/commit/bc87ec2d85973bfd8aebec8be1d7a3d7efc545cd)), closes [hi#DPI](https://github.com/hi/issues/DPI)
* **windows:** flyin diagnostics, stream-lifetime and UIA STA; accent-color flash ([2ddfc1c](https://github.com/TaurusWood/dsh-plugin-appshot/commit/2ddfc1c8ac586ee2ace12dc3d0f182c54f7b593f))
* **windows:** flyin never played - bad P/Invoke entry point and exact-match UIA name ([61f7f16](https://github.com/TaurusWood/dsh-plugin-appshot/commit/61f7f166659d11fb37bb97dcf8a2d8c290a68c3c))
* **windows:** persist plugin config across host restarts ([0ed852a](https://github.com/TaurusWood/dsh-plugin-appshot/commit/0ed852a4339b49276beb9b23478c8f1bd10f2fb1))
* **windows:** refuse capture when DSH is the frontmost window ([2ab2344](https://github.com/TaurusWood/dsh-plugin-appshot/commit/2ab234472fc29f6990bebb32dc91c6ad4a426649))
* **windows:** start feedback in parallel and remove flyin jank ([1a4789e](https://github.com/TaurusWood/dsh-plugin-appshot/commit/1a4789eb34d0f230806d42052c00879377b0b7e6))
* **windows:** unify capture timing domain and harden agent after live debugging ([0872121](https://github.com/TaurusWood/dsh-plugin-appshot/commit/087212166f7b9af1673f91871a5d7001c7a62ff7))


### Features

* **windows:** capture flash border animation ([880d102](https://github.com/TaurusWood/dsh-plugin-appshot/commit/880d102a46d74092751805d552c93884476eb3a4))
* **windows:** enhance client draft claiming, ACK backoff, and storage index (W4) ([762b0fd](https://github.com/TaurusWood/dsh-plugin-appshot/commit/762b0fd8dadf1d8e67ffb59d6968ef76c3e5919c))
* **windows:** fly-in animation of capture thumbnail to taskbar DSH icon ([b24423b](https://github.com/TaurusWood/dsh-plugin-appshot/commit/b24423b02a62adad23912f640f5556441da62b4f)), closes [hi#quality](https://github.com/hi/issues/quality)
* **windows:** hotkey config IPC and modifier key customization ([bead58b](https://github.com/TaurusWood/dsh-plugin-appshot/commit/bead58bf7bb963a9ca1d4241b57d9c6f945f484a))
* **windows:** hotkey recorder control with Shift-enabled modifier pool ([7accabf](https://github.com/TaurusWood/dsh-plugin-appshot/commit/7accabf814dae736883468655a6b1515add25d87))
* **windows:** implement client draft recovery, silent mounting, and dual-platform branching (W4) ([ce4bd35](https://github.com/TaurusWood/dsh-plugin-appshot/commit/ce4bd35e1816cd054cb299bfb6b50a681a8d4082))
* **windows:** implement host state machine, safe ingest, and HTTP transport (W2/W3) ([718bb1e](https://github.com/TaurusWood/dsh-plugin-appshot/commit/718bb1ead1cf412513173a6d757737e638732c91))
* **windows:** implement Windows Native Agent (Phase W1/W2) ([ca613c6](https://github.com/TaurusWood/dsh-plugin-appshot/commit/ca613c6ad59c4ebae97bb0d39fcb649430f1fffa))
* **windows:** louder and crisper shutter sound ([df1168c](https://github.com/TaurusWood/dsh-plugin-appshot/commit/df1168c6057e72ac06ab6ffbf50663b3b08defc2))
* **windows:** replace synthesized shutter with real camera sample ([c235d22](https://github.com/TaurusWood/dsh-plugin-appshot/commit/c235d2204763e28d31c286d06d9ad697e58d0643))
* **windows:** settings panel hotkey customization UI ([c1dffb2](https://github.com/TaurusWood/dsh-plugin-appshot/commit/c1dffb294ef1c5dd1110e32fcf0a95b51b3b21d7))
* **windows:** shutter sound feedback after PNG flush ([a31ddf5](https://github.com/TaurusWood/dsh-plugin-appshot/commit/a31ddf5ae66e8ce1181d59ca05e68840111cf9cd))
* **windows:** target the topmost window on the cursor's monitor ([5452dcd](https://github.com/TaurusWood/dsh-plugin-appshot/commit/5452dcd7b49f4a3c054d6dfc3c52f9992acd3453))


### Performance Improvements

* **windows:** 60fps flyin with high-resolution timer and smoother easing ([95c958d](https://github.com/TaurusWood/dsh-plugin-appshot/commit/95c958d06a23d9f7aef122f9c73fc7889a10004c)), closes [hi#resolution](https://github.com/hi/issues/resolution) [hi#resolution](https://github.com/hi/issues/resolution)

# [0.2.0](https://github.com/TaurusWood/dsh-plugin-appshot/compare/v0.1.2...v0.2.0) (2026-08-17)


### Bug Fixes

* **release:** run changelog generator before bumpp commit ([e394f8e](https://github.com/TaurusWood/dsh-plugin-appshot/commit/e394f8e445cf7e194818c180c1295e167d91b5fd))


### Features

* **client:** implement settings panel and register into DSH settings slot ([ed3d4ff](https://github.com/TaurusWood/dsh-plugin-appshot/commit/ed3d4ff90d3d87cf34759b3190a9d119a12d71d4))
* **host:** add config models, settings sync, and REST endpoints ([231f20b](https://github.com/TaurusWood/dsh-plugin-appshot/commit/231f20b810e0a3ad46465494aff79a625dc951a8))
* **native:** add capture sound, animation, and configurable shortcut monitor ([0a0ea8e](https://github.com/TaurusWood/dsh-plugin-appshot/commit/0a0ea8e711cce6f88cb129ab959ff9f07d48130d))
* **release:** support bilingual changelog (EN / zh-CN) ([a0b2463](https://github.com/TaurusWood/dsh-plugin-appshot/commit/a0b2463c91c68305858ffc7784941198122c4c65))

## [0.1.2](https://github.com/TaurusWood/dsh-plugin-appshot/compare/v0.1.1...v0.1.2) (2026-08-17)


### Bug Fixes

* **agent:** ensure native binary has executable permissions before spawn ([913c059](https://github.com/TaurusWood/dsh-plugin-appshot/commit/913c059f6cc8d9f417e48114692f4b819efe0193))

## [0.1.1](https://github.com/TaurusWood/dsh-plugin-appshot/compare/v0.1.0...v0.1.1) (2026-08-16)

# [0.1.0](https://github.com/TaurusWood/dsh-plugin-appshot/compare/1fc499431b6af68909487db175c8facee3b1f492...v0.1.0) (2026-08-16)


### Bug Fixes

* **native:** explicitly encode null window title for json compatibility ([9f7ff4f](https://github.com/TaurusWood/dsh-plugin-appshot/commit/9f7ff4fb3faecc9de37609b5d3748b200bfa7989))
* **native:** resolve activateIgnoringOtherApps deprecation on macOS 14+ ([fda350c](https://github.com/TaurusWood/dsh-plugin-appshot/commit/fda350cd5016c1cd8078757db0b19f850baa6c25))
* **native:** use device-dependent modifier masks for double-command detection ([94133a9](https://github.com/TaurusWood/dsh-plugin-appshot/commit/94133a9b7a2ea0990b0ad9eab45ee6641169337e))


### Features

* **client:** decode image bytes from sse frame and mount to composer draft ([294a7e6](https://github.com/TaurusWood/dsh-plugin-appshot/commit/294a7e69d88f2e75daddd745301e913c325f6ff4))
* **client:** 实现客户端模块 SSE 消费、Composer 挂载与防自截全链路验证 (Phase 5 T5.1/T5.2) ([532c6e4](https://github.com/TaurusWood/dsh-plugin-appshot/commit/532c6e4850645036c9732d3e2d2c433e14614ec0))
* **host,native:** activate and focus dsh window on screenshot completion ([e4f074e](https://github.com/TaurusWood/dsh-plugin-appshot/commit/e4f074e848f699ca8262e2c931817a0f7ae0bda1))
* **host:** wire agent lifecycle and broadcast image bytes via sse ([d1fbd3d](https://github.com/TaurusWood/dsh-plugin-appshot/commit/d1fbd3d1c76a4fd7d5fba4e432f264f70a6ae1de))
* **ipc:** 实现长连接流式 NDJSON IPC 协议契约与解析器 (Phase 3 T3.2) ([ea5ab0e](https://github.com/TaurusWood/dsh-plugin-appshot/commit/ea5ab0e8daab14f5a654cdcdd2ca2c948e05cf5d))
* **native:** add 1.0s trigger cooldown and busy lock to DoubleCommandMonitor ([7484582](https://github.com/TaurusWood/dsh-plugin-appshot/commit/7484582cb97e2039062e368be2cb640a547e3656))
* **native:** 实现 ScreenCaptureKit 单窗口截图与前台窗口过滤识别 (Phase 1 T1.1/T1.2) ([77100db](https://github.com/TaurusWood/dsh-plugin-appshot/commit/77100db549772d436980c4b7e03d8297d952dc04))
* **native:** 实现全局双 Command 按键状态机与守护进程模式 (Phase 3 T3.1) ([635dc88](https://github.com/TaurusWood/dsh-plugin-appshot/commit/635dc88a93bf791fb0533c7840295d9866ab1c9c))
* **native:** 构建 macOS 后台 Agent.app 与权限检测/原生窗口唤起 (Phase 2 T2.1/T2.2) ([b4bee7f](https://github.com/TaurusWood/dsh-plugin-appshot/commit/b4bee7fcd8e8319922ddaceebff32f6ab9140729))
* **plugin:** 实现 Attachment 字节持久化、原子所有权转移与孤儿 GC (Phase 4 T4.2) ([dad3e38](https://github.com/TaurusWood/dsh-plugin-appshot/commit/dad3e38061c00989fe649d4c74694fa95872362b))
* **plugin:** 实现 Native Agent 进程生命周期管控与就绪握手 (Phase 4 T4.1) ([1a956c9](https://github.com/TaurusWood/dsh-plugin-appshot/commit/1a956c901048d77bfc6da195ea89d7bc260a96d1))
* **plugin:** 改造 Cordis 插件架构模式与服务依赖 (Phase 0 T0.1) ([1fc4994](https://github.com/TaurusWood/dsh-plugin-appshot/commit/1fc499431b6af68909487db175c8facee3b1f492))
* **plugin:** 注册 WebServer SSE 广播通道并实现事件分发 (Phase 4 T4.3) ([322a05c](https://github.com/TaurusWood/dsh-plugin-appshot/commit/322a05c5dabf25c9e8ca5a071f7dad01240cd368))

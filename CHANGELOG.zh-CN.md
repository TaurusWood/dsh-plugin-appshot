# 更新日志

[English](./CHANGELOG.md) | [简体中文](./CHANGELOG.zh-CN.md)

## [0.1.2](https://github.com/TaurusWood/dsh-plugin-appshot/compare/v0.1.1...v0.1.2) (2026-08-17)


### 🐛 问题修复 (Bug Fixes)

* **agent:** ensure native binary has executable permissions before spawn ([02bf4e6](https://github.com/TaurusWood/dsh-plugin-appshot/commit/02bf4e6c7fc9cb54e3c558680ef5aa6ea2da3b9b))

## [0.1.1](https://github.com/TaurusWood/dsh-plugin-appshot/compare/v0.1.0...v0.1.1) (2026-08-16)

# [0.1.0](https://github.com/TaurusWood/dsh-plugin-appshot/compare/43b5bef2ebdaf4a6afd1c6cfe68ba6bb02561f42...v0.1.0) (2026-08-16)


### 🐛 问题修复 (Bug Fixes)

* **native:** explicitly encode null window title for json compatibility ([d67bc5e](https://github.com/TaurusWood/dsh-plugin-appshot/commit/d67bc5eb0dc908ef6656a0d95f852d98f6e1a2e2))
* **native:** resolve activateIgnoringOtherApps deprecation on macOS 14+ ([9758613](https://github.com/TaurusWood/dsh-plugin-appshot/commit/9758613d8bbacf880393ea94ed8f8b45f38fd163))
* **native:** use device-dependent modifier masks for double-command detection ([99b1d72](https://github.com/TaurusWood/dsh-plugin-appshot/commit/99b1d72f09351fb1a586c2943ae32a65ea646f92))


### 🚀 新特性 (Features)

* **client:** decode image bytes from sse frame and mount to composer draft ([6356c15](https://github.com/TaurusWood/dsh-plugin-appshot/commit/6356c152329bdc524002537376259f211cfbfe71))
* **client:** 实现客户端模块 SSE 消费、Composer 挂载与防自截全链路验证 (Phase 5 T5.1/T5.2) ([3b709b0](https://github.com/TaurusWood/dsh-plugin-appshot/commit/3b709b02f0a942b1c94f328a8972cd40b360852b))
* **host,native:** activate and focus dsh window on screenshot completion ([e3ce7ca](https://github.com/TaurusWood/dsh-plugin-appshot/commit/e3ce7ca506da7843d40103acdddeadee22727d9a))
* **host:** wire agent lifecycle and broadcast image bytes via sse ([55ce5c1](https://github.com/TaurusWood/dsh-plugin-appshot/commit/55ce5c1fe0468e40e0c6440ea867edfb77a1b44b))
* **ipc:** 实现长连接流式 NDJSON IPC 协议契约与解析器 (Phase 3 T3.2) ([3e8eccf](https://github.com/TaurusWood/dsh-plugin-appshot/commit/3e8eccf601a41d8d3d43c556f91531853dd91949))
* **native:** add 1.0s trigger cooldown and busy lock to DoubleCommandMonitor ([c8ba1a4](https://github.com/TaurusWood/dsh-plugin-appshot/commit/c8ba1a482767533bf1c3a5f57976b37d4193f8de))
* **native:** 实现 ScreenCaptureKit 单窗口截图与前台窗口过滤识别 (Phase 1 T1.1/T1.2) ([1ea7bab](https://github.com/TaurusWood/dsh-plugin-appshot/commit/1ea7bab50ab56c59b184e469a5b62c129b947eea))
* **native:** 实现全局双 Command 按键状态机与守护进程模式 (Phase 3 T3.1) ([c700579](https://github.com/TaurusWood/dsh-plugin-appshot/commit/c7005791ece70f2a627c74a8d9e157e2ad5ed865))
* **native:** 构建 macOS 后台 Agent.app 与权限检测/原生窗口唤起 (Phase 2 T2.1/T2.2) ([4295b18](https://github.com/TaurusWood/dsh-plugin-appshot/commit/4295b18e0264d9d3b84918ba4d0b0abec6b848e9))
* **plugin:** 实现 Attachment 字节持久化、原子所有权转移与孤儿 GC (Phase 4 T4.2) ([6145044](https://github.com/TaurusWood/dsh-plugin-appshot/commit/6145044c3b513d3232194e1192df8f86a4eb18a3))
* **plugin:** 实现 Native Agent 进程生命周期管控与就绪握手 (Phase 4 T4.1) ([ba59248](https://github.com/TaurusWood/dsh-plugin-appshot/commit/ba592487ee3c9ba0b7c09c113381a03cc204d476))
* **plugin:** 改造 Cordis 插件架构模式与服务依赖 (Phase 0 T0.1) ([43b5bef](https://github.com/TaurusWood/dsh-plugin-appshot/commit/43b5bef2ebdaf4a6afd1c6cfe68ba6bb02561f42))
* **plugin:** 注册 WebServer SSE 广播通道并实现事件分发 (Phase 4 T4.3) ([75d8a60](https://github.com/TaurusWood/dsh-plugin-appshot/commit/75d8a609974b233f6d1bb8e88a10ac794e05c06f))

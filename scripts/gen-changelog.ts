import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const EN_PATH = resolve(ROOT, 'CHANGELOG.md')
const ZH_PATH = resolve(ROOT, 'CHANGELOG.zh-CN.md')

const NAV_EN = '# Changelog\n\n[English](./CHANGELOG.md) | [简体中文](./CHANGELOG.zh-CN.md)\n\n'
const NAV_ZH = '# 更新日志\n\n[English](./CHANGELOG.md) | [简体中文](./CHANGELOG.zh-CN.md)\n\n'

// 1. 生成英文版 CHANGELOG
try {
  execSync('npx conventional-changelog -p angular -i CHANGELOG.md -s -r 0', {
    cwd: ROOT,
    stdio: 'inherit',
  })
} catch (err) {
  console.error('Failed to run conventional-changelog:', err)
  process.exit(1)
}

// 2. 读取生成的英文内容并确保导航栏
let enContent = readFileSync(EN_PATH, 'utf-8').trim()
if (!enContent.startsWith('# Changelog')) {
  enContent = NAV_EN + enContent
}
writeFileSync(EN_PATH, enContent + '\n', 'utf-8')

// 3. 翻译/转换生成中文版
const SECTION_MAP: Array<[RegExp, string]> = [
  [/### Bug Fixes/g, '### 🐛 问题修复 (Bug Fixes)'],
  [/### Features/g, '### 🚀 新特性 (Features)'],
  [/### Performance Improvements/g, '### ⚡ 性能优化 (Performance)'],
  [/### Documentation/g, '### 📖 文档更新 (Documentation)'],
  [/### Code Refactoring/g, '### ♻️ 代码重构 (Refactoring)'],
  [/### Tests/g, '### 🧪 测试 (Tests)'],
  [/### Chores/g, '### 🔧 工程维护 (Chores)'],
  [/### Reverts/g, '### ⏪ 代码回滚 (Reverts)'],
]

let zhBody = enContent.replace(NAV_EN, '')
for (const [pattern, replacement] of SECTION_MAP) {
  zhBody = zhBody.replace(pattern, replacement)
}

const zhContent = NAV_ZH + zhBody.trim() + '\n'
writeFileSync(ZH_PATH, zhContent, 'utf-8')

console.log('✔ CHANGELOG.md and CHANGELOG.zh-CN.md generated successfully.')

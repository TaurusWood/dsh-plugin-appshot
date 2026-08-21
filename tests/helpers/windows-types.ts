/**
 * tests/helpers/windows-types.ts — Windows Basic 契约类型（测试侧镜像）。
 *
 * 接线说明：类型事实来源为 src/windows/types.ts（生产实现），本文件仅 re-export，
 * 避免测试与生产出现双份类型漂移。权威依据：
 * - docs/requirements-windows.md
 * - docs/technical-windows.md
 */
export type * from '../../src/windows/types.ts'

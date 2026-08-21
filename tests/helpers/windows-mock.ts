/**
 * tests/helpers/windows-mock.ts — Windows Basic 测试辅助与 Mock 环境。
 *
 * 接线说明：validateWindowsStagingPath / validatePngPayload 的事实来源为
 * src/windows/safe-ingest.ts（生产实现），本文件仅 re-export，避免双份实现漂移。
 * RouteRegistration.kind 对齐 api-grounded-review.md §3.1 已核实形态：'exact' | 'prefix'
 * （DSH webServer.register 的 kind 契约，非 'http'）。
 */
import { validateWindowsStagingPath, validatePngPayload } from '../../src/windows/safe-ingest.ts'

export { validateWindowsStagingPath, validatePngPayload }

export interface RouteRegistration {
  kind: 'exact' | 'prefix'
  path: string
  handler: (req: unknown, res: unknown) => void | Promise<void>
}

export interface MockWindowsWebServer {
  routes: Map<string, RouteRegistration>
  register(route: RouteRegistration): void
}

export function createMockWindowsWebServer(): MockWindowsWebServer {
  const routes = new Map<string, RouteRegistration>()
  return {
    routes,
    register(route: RouteRegistration) {
      routes.set(route.path, route)
    },
  }
}

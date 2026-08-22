/**
 * W4 reload 探针：触发 Renderer reload（client 重新 apply；Host 侧不变）。
 * 用法：node scripts/w4-reload.ts
 */
import { connectCdp } from './cdp.ts'

const cdp = await connectCdp(9222)

await cdp.send('Page.enable')
await cdp.send('Page.reload', { ignoreCache: true })
console.log('reload issued')
await new Promise((r) => setTimeout(r, 5000))
console.log('done')

cdp.close()

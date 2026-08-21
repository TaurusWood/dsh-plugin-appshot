import { spawnSync } from 'node:child_process'
import process from 'node:process'

const isWindows = process.platform === 'win32'
const isMac = process.platform === 'darwin'

const explicitArg = process.argv[2]

let testPatterns = []
if (explicitArg === '--win' || explicitArg === '--windows' || (isWindows && !explicitArg)) {
  testPatterns = ['tests/phase-w*.test.ts', 'tests/phase7-*.test.ts']
} else if (explicitArg === '--mac' || explicitArg === '--macos' || (isMac && !explicitArg)) {
  testPatterns = ['tests/phase0-*.test.ts', 'tests/phase1-*.test.ts', 'tests/phase2-*.test.ts', 'tests/phase3-*.test.ts', 'tests/phase4-*.test.ts', 'tests/phase5-*.test.ts', 'tests/phase6-*.test.ts', 'tests/phase7-*.test.ts']
} else {
  testPatterns = ['tests/**/*.test.ts']
}

console.log(`[test-runner] running tests for platform: ${process.platform} (${testPatterns.join(' ')})`)

const result = spawnSync('node', [
  '--test',
  '--test-concurrency=1',
  ...testPatterns,
], {
  stdio: 'inherit',
  env: {
    ...process.env,
    DSH_DISABLE_AGENT_SPAWN: '1',
  },
  shell: true,
})

process.exit(result.status ?? 0)

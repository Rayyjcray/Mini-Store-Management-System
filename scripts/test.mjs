import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
mkdirSync('test-output', { recursive: true })
await build({
  entryPoints: [
    'tests/store.test.ts',
    'tests/auth.test.ts',
    'tests/accounts.test.ts',
    'tests/shops.test.ts',
  ],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  packages: 'external',
  outdir: 'test-output',
  outExtension: { '.js': '.cjs' },
})
const result = spawnSync(
  require('electron'),
  [
    '--test',
    '--test-concurrency=1',
    'test-output/store.test.cjs',
    'test-output/auth.test.cjs',
    'test-output/accounts.test.cjs',
    'test-output/shops.test.cjs',
  ],
  {
    stdio: 'inherit',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  },
)
if (result.error) console.error(result.error)
process.exit(result.status ?? 1)

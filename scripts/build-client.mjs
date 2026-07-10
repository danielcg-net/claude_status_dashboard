import { readFileSync } from 'node:fs'
import { build } from 'esbuild'

const pkg = JSON.parse(readFileSync('package.json', 'utf-8'))

await build({
  entryPoints: ['src/client.ts'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['es2022'],
  outfile: 'public/assets/client.js',
  sourcemap: true,
  define: {
    __VERSION__: JSON.stringify(pkg.version),
  },
})

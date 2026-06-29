import { build } from 'esbuild'

await build({
  entryPoints: ['src/client.ts'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['es2022'],
  outfile: 'public/assets/client.js',
  sourcemap: true,
})

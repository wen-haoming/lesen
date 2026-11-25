import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite-plus'

const rootDir = path.dirname(fileURLToPath(import.meta.url))
const productVersion = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8')).version

export default defineConfig({
  define: {
    __LESEN_VERSION__: JSON.stringify(productVersion),
  },
  resolve: {
    alias: {
      '@': path.resolve(rootDir, 'src'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'scripts/**/*.test.mjs', 'analytics-worker/src/**/*.test.ts'],
  },
})

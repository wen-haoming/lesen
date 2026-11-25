#!/usr/bin/env node
/** Generate PNG icon sizes from the master. Prefer macOS sips; on Linux CI fall back to already-tracked icons. */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const iconDir = path.join(root, 'icons')
const publicDir = path.join(root, 'public', 'icons')
const master = path.join(iconDir, 'icon-source.png')
const sizes = [16, 32, 48, 128]
const label = '卡通猫头鹰信息聚合器图标'

function commandExists(name) {
  try {
    execFileSync('sh', ['-c', `command -v ${name}`], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

if (!fs.existsSync(master)) throw new Error(`Missing icon master: ${master}`)
fs.mkdirSync(publicDir, { recursive: true })

const canSips = commandExists('sips')
if (!canSips) {
  const missing = sizes.filter((size) => !fs.existsSync(path.join(iconDir, `icon${size}.png`)))
  if (missing.length) {
    throw new Error(`sips 不可用，且缺少已跟踪图标：${missing.map((s) => `icon${s}.png`).join(', ')}。请在 macOS 上运行本脚本后提交图标。`)
  }
  console.log('[generate-icons] sips 不可用，使用仓库已跟踪的图标，不重新栅格化')
} else {
  for (const size of sizes) {
    const filename = `icon${size}.png`
    const output = path.join(iconDir, filename)
    execFileSync('sips', ['-s', 'format', 'png', '-z', String(size), String(size), master, '--out', output], { stdio: 'inherit' })
    console.log(`[generate-icons] ${filename} ${size}x${size}`)
  }
}

// Strip non-rendering metadata, including EXIF and generator provenance containers.
// The source prompt remains in icons/icon-source.prompt.txt; pixel data is unchanged.
function stripPrivatePngMetadata(file) {
  const input = fs.readFileSync(file)
  const chunks = [input.subarray(0, 8)]
  const excluded = new Set(['caBX', 'eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME'])
  for (let offset = 8; offset + 12 <= input.length;) {
    const end = offset + 12 + input.readUInt32BE(offset)
    if (end > input.length) throw new Error('Invalid PNG chunk boundary')
    if (!excluded.has(input.toString('ascii', offset + 4, offset + 8))) chunks.push(input.subarray(offset, end))
    offset = end
  }
  fs.writeFileSync(file, Buffer.concat(chunks))
}

for (const size of sizes) {
  const filename = `icon${size}.png`
  stripPrivatePngMetadata(path.join(iconDir, filename))
  fs.copyFileSync(path.join(iconDir, filename), path.join(publicDir, filename))
}

const icon128 = fs.readFileSync(path.join(iconDir, 'icon128.png')).toString('base64')
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" role="img" aria-label="${label}"><title>${label}</title><image width="128" height="128" href="data:image/png;base64,${icon128}"/></svg>\n`
fs.writeFileSync(path.join(iconDir, 'icon.svg'), svg)
fs.writeFileSync(path.join(publicDir, 'icon.svg'), svg)
fs.writeFileSync(path.join(iconDir, 'icon32.png.b64'), fs.readFileSync(path.join(iconDir, 'icon32.png')).toString('base64'))
console.log('[generate-icons] SVG wrappers and icon32 base64 synchronized')

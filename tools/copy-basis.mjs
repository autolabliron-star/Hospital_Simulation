// Copies three's basis transcoder (KTX2) into public/basis so the demo runs offline: `npm run copy-basis`.
import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const from = join(root, 'node_modules/three/examples/jsm/libs/basis')
const to = join(root, 'public/basis')
mkdirSync(to, { recursive: true })
for (const f of ['basis_transcoder.js', 'basis_transcoder.wasm']) {
  copyFileSync(join(from, f), join(to, f))
  console.log('copied', f)
}

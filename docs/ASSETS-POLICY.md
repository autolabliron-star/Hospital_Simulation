> Adopted from Waltz City for The Ideal Hospital. No art assets are downloaded yet; geometry is procedural.

# Asset and dependency validation policy

Nothing is downloaded into this project without passing this gate. The gate is enforced by
`tools/fetch-assets.mjs` for art assets and by the rules below for npm packages.

## npm packages
- Only packages with a known maintainer organisation (pmndrs, mrdoob, Khronos, statelyai,
  colinhacks, dimforge, Mugen87, yomotsu, N8python) or a very large install base.
- Versions are **pinned exactly** in `package.json`. No `^` or `~`.
- `npm install` is followed by `npm audit`; any high or critical finding blocks the install until
  resolved or the package is replaced.
- No `postinstall` scripts from packages we do not already trust; `npm install --ignore-scripts`
  is the default, and the few packages that need scripts (none expected) are allow-listed.

## Art assets (models, textures, HDRIs, audio)
- **Sources allow-list**: `github.com/mrdoob/three.js` (example models, MIT, pinned to a commit
  SHA, never a branch), `kenney.nl`, `quaternius.com`, `polyhaven.com` / `dl.polyhaven.org`,
  `ambientcg.com`, `kaylousberg.itch.io`. Anything else needs a line added here first.
- **File types allow-list**: `.glb .gltf .bin .ktx2 .png .jpg .hdr .exr .ogg .mp3 .wav .zip`.
  A zip is listed before extraction and refused if it contains any other extension (no `.exe`,
  `.dmg`, `.pkg`, `.sh`, `.js`, `.blend`, etc.). Exception, added at the wave-2 gate: inert files
  that CC0 packs ship beside the assets (`.txt .md .url .fbx .obj .mtl .dae .stl .svg .tga .psd`)
  may be present, but they are **never extracted**; only the allow-listed types above are.
- **Magic bytes** are checked after download: glTF binary starts with `glTF`, PNG with
  `\x89PNG`, JPEG with `\xFF\xD8`, Radiance HDR with `#?RADIANCE` or `#?RGBE`, zip with `PK`.
- **SHA-256** of every file is recorded in `public/assets/manifest.json` on first fetch and
  verified on every later fetch; a mismatch fails loudly.
- Every `.glb`/`.gltf` is run through the Khronos `gltf-validator`; errors fail the gate,
  warnings are logged. glTF is a data format and cannot execute code, but the validator also
  catches malformed files that could crash the loader.
- Size limits: 50 MB per file, 200 MB total, so a wrong URL cannot fill the disk.
- Licences are recorded per asset in `docs/CREDITS.md` (CC0, MIT, or Mixamo's in-game-only terms).

## What we never do
- Run scripts, binaries or installers fetched from GitHub or any site.
- Clone whole repositories; only the specific data files we need, by pinned SHA.
- Download from a URL pasted in a forum post or issue; only the allow-listed origins above.

> Adopted from Waltz City for The Ideal Hospital. The buildings, props and machines are procedural. The only downloaded art is the
> Microsoft Rocketbox people (W3 wave B, below).

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

### The converter's packages (W3 wave B)
Build-time only (`devDependencies`; nothing here ships in the page), the same exact versions the Waltz reference pinned,
checked with `npm view <pkg> repository.url license maintainers` and installed with
`npm install --ignore-scripts --save-dev --save-exact`:

| Package | Version | Maintainer, licence | Used for |
|---|---|---|---|
| `@gltf-transform/core`, `/extensions`, `/functions` | 4.5.1 | donmccurdy, MIT | writing, quantising and meshopt-compressing the people's glbs |
| `gltf-validator` | 2.0.0-dev.3.10 | Khronos, Apache-2.0 | every glb is validated (0 errors) |
| `meshoptimizer` | 1.3.0 | zeux, MIT | simplifying the LODs, the compression codec |
| `sharp` | 0.35.5 | lovell, Apache-2.0 | packing the texture atlas and encoding WebP (prebuilt `@img/sharp-darwin-arm64`, no install script) |

47 packages came in (sharp's per-platform binaries are optional; only the macOS arm64 one is installed). None declares a
`preinstall`, `install` or `postinstall` script (no `hasInstallScript` in the lockfile). `npm audit`: 0 vulnerabilities.

## Art assets (models, textures, HDRIs, audio)
- **Sources allow-list**: `github.com/mrdoob/three.js` (example models, MIT, pinned to a commit
  SHA, never a branch), `kenney.nl`, `quaternius.com`, `polyhaven.com` / `dl.polyhaven.org`,
  `ambientcg.com`, `kaylousberg.itch.io`, and the Microsoft Rocketbox avatars at one pinned commit (see below).
  Anything else needs a line added here first.
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

### Microsoft Rocketbox avatars (W3 wave B: real people)
- **Source**: `github.com/microsoft/Microsoft-Rocketbox`, files served by `raw.githubusercontent.com`, allow-listed for
  **one commit** (`0943055db6ec570bcef9f2c8b41c9e5467c808f9`, the last commit of the repository), **one folder**
  (`Assets/Avatars/**`) and **two types** (`.fbx`, `.tga`), enforced by `POLICY.rocketbox` / `checkRocketboxPath` in
  `tools/assets-lib.mjs` (ported from the Waltz reference, where this exact gate shipped). At that commit the files are plain
  git blobs, not Git LFS pointers, so `media.githubusercontent.com` is **not** allow-listed. Other commits, branches,
  folders and file types are refused, and so is every redirect to a host that is not on the list.
- **Licence, checked before any download**: `LICENSE.md` at that commit is git blob
  `9bcfb3ece5301a55d3a41bbd00a029ab27d61d13` (1,066 bytes, re-read from the GitHub API on 2026-10-18, the same blob the Waltz
  reference recorded): the standard **MIT License**, "Copyright (c) 2020 Microsoft". MIT asks that the copyright and permission
  notice ship with the avatars, so the converter writes it to `public/assets/people/LICENSE.txt`.
- **What is fetched**: only what the converter needs, for the 8 medical avatars (`Assets/Avatars/Professions/Medical_Female_01..03`,
  `Medical_Male_01..05`): each one's `Export/<Name>.fbx` (the mesh and its skin) and its `body_color`, `head_color` and, where
  it has hair cards, `opacity_color` TGA, plus the stethoscope and "protection" (cap and mask) colour TGAs. Never the normal or
  specular maps, the `_facial.fbx` exports, the `.max` sources or the animations. About 306 MB in all. Each file has a manifest
  entry (`tools/assets.manifest.json`) with the URL, the **git blob id** listed by the GitHub API for that commit (the gate
  hashes the downloaded bytes as a git blob and refuses a mismatch: the bytes are provably the ones at the pinned commit),
  the exact byte count, a size cap 2 % above it, and the sha256 pinned at the first fetch and re-checked on every later one.
- **The 6 everyday adults** (`Adults/Female_Adult_15`, `_17`, `Male_Adult_08`, `_12`, `_13`, `Professions/Business_Female_02`)
  are not downloaded again: they are imported through the gate's `localFile` path from the Waltz reference's already-verified
  copies, and must match the sha256 and git blob ids Waltz pinned for the same commit.
- **Magic bytes**: FBX must be binary FBX 7.x (`Kaydara FBX Binary  \0\x1a\0`, version 7000 to 7999; ASCII FBX is refused). A TGA
  has no leading magic, so its header is checked field by field (no colour map, true-colour or grey, uncompressed or RLE,
  1 to 8192 px, 24/32-bit, and for an uncompressed image exactly the pixel bytes the header promises).
- **Conversion inputs are never served**: `.fbx` and `.tga` entries must say `"dest": "source"`; they are installed in
  `assets-src/people/` (gitignored, outside `public/`, so Vite never ships them), with their own budget
  (`POLICY.maxSourceBytes`, 1 GB) apart from the 200 MB of served assets.
- **Nothing downloaded is executed**: the gate only reads bytes. The converter reads each FBX as data with three's
  `FBXLoader` (no code in an FBX runs; textures are only named), decodes the TGAs with macOS `sips`, re-checks every input's
  sha256 first, and writes per avatar three validated glbs (LOD 0/1/2) and a WebP atlas, plus `index.json` and
  `LICENSE.txt`, to `public/assets/people/` (a few MB), recorded in `public/assets/manifest.json` as derived files.

## What we never do
- Run scripts, binaries or installers fetched from GitHub or any site.
- Clone whole repositories; only the specific data files we need, by pinned SHA.
- Download from a URL pasted in a forum post or issue; only the allow-listed origins above.

/**
 * The surgery scene's per-frame paths allocate nothing: no `new`, no array or object literals, no spreads, no closures and no array methods inside the functions
 * that run every frame (a GC pause is a hitch in the middle of a walk). This reads the source, like src/scene/drawCentre/noAllocations.test.ts, and follows the
 * helpers: the chain from the layer's frame callbacks to the last matrix (and the cart's blocker box) is listed here, and (R3) the endoscope picture's whole paint,
 * from the view it fills to the HUD (src/scene/surgery/endo/). (The V8 sampling profiler in rig.test.ts measures the rig's frame itself.)
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()

/** Code with comments and string contents blanked, keeping line numbers. */
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/.*$/gm, '')
    .replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g, (m) => m.replace(/[^\n]/g, ' '))
}

/** The body of the function or method called `name` (brace matching; the parameter list is skipped by paren matching). */
function bodyOf(src: string, name: string): string {
  const header = new RegExp(`(?:function\\s+${name}\\s*\\(|^[ \\t]*(?:(?:private|public|protected|readonly|static|get|set)\\s+)*${name}\\s*\\()`, 'm')
  const m = header.exec(src)
  if (!m) throw new Error(`no function ${name}`)
  let i = m.index + m[0].length
  let depth = 1
  for (; i < src.length && depth > 0; i++) {
    if (src[i] === '(') depth++
    else if (src[i] === ')') depth--
  }
  const open = src.indexOf('{', i)
  let braces = 0
  let end = open
  for (; end < src.length; end++) {
    if (src[end] === '{') braces++
    else if (src[end] === '}' && --braces === 0) break
  }
  return src.slice(open, end + 1)
}

const FLAGGED: [RegExp, string][] = [
  [/\bnew\s+[A-Za-z]/, 'new'],
  [/(^|[=(,:?&|]|\breturn)\s*\[/m, 'array literal'],
  [/(^|[=(,?&|]|\breturn)\s*\{\s*[a-zA-Z_]+\s*:/m, 'object literal'],
  [/\.\.\./, 'spread'],
  [/=>/, 'closure'],
  [/\.(map|filter|reduce|slice|concat|splice|forEach)\(/, 'array method'],
  [/\bfunction\b/, 'inner function'],
]

const PATHS: Record<string, string[]> = {
  'rig.ts': ['writeCart', 'writeArm', 'ledModeOf', 'writeRings', 'writeLaser', 'writeDrape', 'writeLights', 'step'],
  'robotPose.ts': ['poseRobot', 'elbowUp', 'solveTilt', 'tiltDistance', 'tipMotion', 'motionGain', 'angleDelta', 'smooth01', 'clamp01', 'lerp', 'h01'],
  'matrices.ts': ['hideInstance', 'put', 'putYawed', 'putSegment', 'putSegmentPart'],
  // R5 wave 2: the live table top (and the laser's tilted landing point)
  'table.ts': ['clamp01', 'settle', 'boxAt', 'boxBounds', 'stirPoint', 'acrossInto', 'hideBoot', 'writeBoot', 'writeBrace', 'writeTable'],
  'dims.ts': ['laserTargetInto'],
  'liveEndoscope.ts': ['playerInOr', 'inOr', 'cameraLive', 'update'],
  // R3: the endoscope picture, every function a paint runs (the plate, the wet layer, the tools, the light, the HUD) and the view it reads
  // (R5: the step's stage: read from the room's view, the camera's place for it, and what it lays over the tissue)
  'endo/view.ts': ['fillEndoView', 'fillStage', 'withdrawOf', 'energyAt', 'cameraPose', 'clampTo'],
  'endo/frame.ts': ['tipOnScreen', 'windowInto', 'drawTissue', 'drawPlainField', 'clampTo', 'sprite', 'spritePart', 'basis', 'drawShaft', 'drawTent', 'drawInstrument', 'needle', 'glint', 'drawShadows', 'flickerAt', 'drawLight'],
  'endo/hud.ts': ['roundRect', 'widthOfLook', 'draw', 'chipWidth', 'box', 'badge', 'chip'],
  'endo/stages.ts': ['stageIndex', 'procOfId', 'stageCamInto', 'stageGlow', 'glowOf', 'progressOf', 'fadeOf', 'appear', 'stamp', 'drawPatch', 'drawClip', 'drawSuture', 'drawMark', 'drawStage', 'drawGlow'],
  'endo/paint.ts': ['paint'],
  'endo/looks.ts': ['lookIndexOf'],
  'endo/field.ts': ['smooth'],
  '../../ui/walk/consoleCard.canvas.ts': ['update'],
  '../interact/surgery/teaching.ts': ['tick', 'end'],
  'cartBlocker.ts': ['writeCartBlocker'],
  // R5 wave 2 (agent H): the prepped skin, drapes and skin marks. The whole frame (stepStageRuntime -> stepStage), and every builder a rebuild runs (a few times a second while
  // `drape` eases, at once when a mark or a docking changes): preallocated typed arrays, no closures, no helper objects
  'stage/stage.ts': ['drapeShown', 'setPart', 'sitesKey', 'build', 'stepStage', 'stageTriangles'],
  // (runtime.ts `findPatient` looks through the crowd twice a second at most, with a callback made once: Map.forEach, which this scan flags by name, allocates nothing)
  'stage/runtime.ts': ['layoutOf', 'stepStageRuntime'],
  'stage/mesh.ts': ['resetMesh', 'setColour', 'addVert', 'addTri', 'finishNormals', 'addGrid', 'boxFace', 'addBox'],
  'stage/sheet.ts': ['fillProfile', 'writeRow', 'buildSheet'],
  'stage/screen.ts': ['buildScreen'],
  'stage/legs.ts': ['axisInto', 'writeRing', 'sleeveLead', 'buildSleeve'],
  'stage/legFrame.ts': ['ringFrameInto'],
  // the fit to the patient on the table (selected at the start of a build, read by every lookup in it)
  'stage/fit.ts': ['fitIndexOf', 'selectFit', 'fitActive', 'bilinear', 'blend', 'fitEnvelopeH', 'fitSkinH', 'fitLegInto'],
  'stage/perineum.ts': ['periHalfWidth', 'buildPerineum'],
  'stage/plate.ts': ['plateH', 'onPlate', 'buildPlate', 'paintPlate'],
  'stage/marks.ts': ['disc', 'rect', 'prism', 'colour', 'buildMarks'],
  'stage/envelope.ts': ['envelopeH', 'legRingInto', 'legRingsPerpendicular'],
  'stage/ports.ts': ['portSitesInto'],
}

describe('the per-frame paths of the surgery scene allocate nothing', () => {
  for (const [file, names] of Object.entries(PATHS)) {
    it(`${file}: ${names.join(', ')}`, () => {
      const src = code(readFileSync(join(ROOT, 'src/scene/surgery', file), 'utf8'))
      const offenders: string[] = []
      for (const name of names) {
        const body = bodyOf(src, name)
        expect(body.length, `${file} ${name}: the scan found its body`).toBeGreaterThan(10)
        body.split('\n').forEach((line, i) => {
          for (const [re, what] of FLAGGED) if (re.test(line)) offenders.push(`${file} ${name}+${i}: ${what}: ${line.trim()}`)
        })
      }
      expect(offenders).toEqual([])
    })
  }

  it('SurgeryLayer\'s three frame callbacks allocate nothing (the rig, the screens, the cart\'s blocker box)', () => {
    const src = code(readFileSync(join(ROOT, 'src/scene/surgery/SurgeryLayer.tsx'), 'utf8'))
    let from = 0
    let found = 0
    for (;;) {
      const start = src.indexOf('useFrame(', from)
      if (start < 0) break
      // the text of the call: from its opening parenthesis to the matching one
      const open = src.indexOf('(', start)
      let depth = 0
      let end = open
      for (; end < src.length; end++) {
        if (src[end] === '(') depth++
        else if (src[end] === ')' && --depth === 0) break
      }
      const call = src.slice(open, end)
      // the callback itself is the one closure; everything inside its body is flagged
      const body = call.slice(call.indexOf('=>') + 2)
      const offenders: string[] = []
      body.split('\n').forEach((line, i) => {
        for (const [re, what] of FLAGGED) if (re.test(line)) offenders.push(`useFrame #${found}+${i}: ${what}: ${line.trim()}`)
      })
      expect(offenders).toEqual([])
      found++
      from = end
    }
    expect(found).toBe(3)
  })

  it('the stage layer\'s one frame callback allocates nothing (R5 wave 2: it hands the room\'s patient view to the stage runtime)', () => {
    const src = code(readFileSync(join(ROOT, 'src/scene/surgery/stage/StageLayer.tsx'), 'utf8'))
    const start = src.indexOf('useFrame(')
    expect(start).toBeGreaterThan(0)
    expect(src.indexOf('useFrame(', start + 1)).toBe(-1)
    const open = src.indexOf('(', start)
    let depth = 0
    let end = open
    for (; end < src.length; end++) {
      if (src[end] === '(') depth++
      else if (src[end] === ')' && --depth === 0) break
    }
    const call = src.slice(open, end)
    const body = call.slice(call.indexOf('=>') + 2)
    const offenders: string[] = []
    body.split('\n').forEach((line, i) => {
      for (const [re, what] of FLAGGED) if (re.test(line)) offenders.push(`StageLayer useFrame+${i}: ${what}: ${line.trim()}`)
    })
    expect(offenders).toEqual([])
    // the same frame order as the rig, and a negative priority
    const raw = readFileSync(join(ROOT, 'src/scene/surgery/stage/StageLayer.tsx'), 'utf8')
    expect(raw).toContain('FRAME_PRIORITY.surgeryRig')
  })

  it('uses negative frame priorities from the shared frame order (positive ones take over rendering in R3F)', () => {
    const src = readFileSync(join(ROOT, 'src/scene/surgery/SurgeryLayer.tsx'), 'utf8')
    expect(src).toContain('FRAME_PRIORITY.surgeryRig')
    expect(src).toContain('FRAME_PRIORITY.surgeryScreens')
    // the cart's blocker box is written with the door leaves, before you move against it
    expect(src).toContain('FRAME_PRIORITY.doors')
  })

  it('the scan itself catches the allocations it is meant to catch, and lets plain arithmetic through', () => {
    const bad = bodyOf(code('function bad(x: number) {\n  const v = new Vector3()\n  const a = [x, 1]\n  const f = () => x\n  return { x: 1 }\n}'), 'bad')
    const hits = FLAGGED.filter(([re]) => bad.split('\n').some((l) => re.test(l))).map(([, what]) => what)
    expect(hits).toEqual(expect.arrayContaining(['new', 'array literal', 'closure', 'object literal']))
    const fine = bodyOf(code('function fine(x: number, o: { a: number }) {\n  o.a = x * 2 + o.a\n  const y = o.a > 1 ? x : -x\n  return y\n}'), 'fine')
    expect(FLAGGED.filter(([re]) => fine.split('\n').some((l) => re.test(l)))).toEqual([])
  })
})

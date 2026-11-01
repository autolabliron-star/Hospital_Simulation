/**
 * R5 wave 2 (agent H): the colours of the stage (the prepped skin, the sterile drapes, the skin marks), as the LINEAR vertex colours the shared `MACHINE_BODY` material
 * reads (sRGB hex in, three's colour management turns it linear, once, at load). Nothing here is red: antiseptic tint is a pale orange-pink, the pen is purple, a
 * port nick is grey, a closed line is a skin-grey, a dressing is white (stage.noRed.test.ts runs every colour through the endoscope's blood tiers).
 */
import { Color } from 'three'

export interface Rgb {
  readonly r: number
  readonly g: number
  readonly b: number
}

function lin(hex: string): Rgb {
  const c = new Color(hex)
  return Object.freeze({ r: c.r, g: c.g, b: c.b })
}

export const STAGE_HEX = {
  /** The patient's skin in the prepped window: neutral and matte, a light brown-beige. */
  skin: '#e2c2a8',
  /** Chlorhexidine-alcohol painted on: a pale orange-pink. */
  antiseptic: '#efbd9e',
  /** The sterile drapes: a mid surgical blue. */
  drape: '#4f8fc0',
  /** A drape's anaesthetic screen (a shade lighter: it catches the light standing up). */
  screen: '#5b9bc9',
  /** The drape bar and its uprights: brushed steel. */
  bar: '#b9c1c4',
  /** The marking pen. */
  pen: '#6b4fa6',
  /** A port nick (a 8 mm stab): grey. */
  nick: '#7b7679',
  /** The cannula stub: a light grey sleeve with a darker cap. */
  stub: '#b4bdc1',
  stubCap: '#6f797d',
  /** A closed port: a thin line of skin glue, a shade darker and greyer than the skin. */
  closed: '#a29189',
  /** A dressing: white. */
  dressing: '#f4f5f4',
} as const

export const COLOUR = {
  skin: lin(STAGE_HEX.skin),
  antiseptic: lin(STAGE_HEX.antiseptic),
  drape: lin(STAGE_HEX.drape),
  screen: lin(STAGE_HEX.screen),
  bar: lin(STAGE_HEX.bar),
  pen: lin(STAGE_HEX.pen),
  nick: lin(STAGE_HEX.nick),
  stub: lin(STAGE_HEX.stub),
  stubCap: lin(STAGE_HEX.stubCap),
  closed: lin(STAGE_HEX.closed),
  dressing: lin(STAGE_HEX.dressing),
} as const satisfies Record<keyof typeof STAGE_HEX, Rgb>

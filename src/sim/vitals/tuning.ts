/**
 * W4 health kiosks: the small numbers of the station script that are not research figures (those live in CONFIG.vitals with their sources):
 * how long a platform takes to clear, how long a person who never arrives is waited for, the measurement noise of each device.
 * Local to src/sim/vitals so the contract config stays untouched; the report lists them as a change request if the orchestrator wants them there.
 */
export const TUNING = {
  /** A kiosk stays idle this long after somebody leaves, so the next person never walks onto the platform through the last one. */
  turnoverSeconds: 3,
  /** Somebody called who has not stepped onto the platform after this long is taken as arrived (counted in `stats.forcedArrivals`). */
  callTimeoutSeconds: 45,
  /** A subject the service cannot see (no entity, not an ER patient) is taken as arrived after this long. */
  unknownArrivalSeconds: 6,
  /** How close to the stand spot a walker counts as on the platform (m). */
  arriveRadius: 0.5,
  /** The walk or glide from the stool back to the platform, inside the 'temp' phase (s). */
  standUpSeconds: 2.2,
  /** The glide onto the stool, inside the 'sit' phase: the seated pose shows after this (s). */
  seatSettleSeconds: 1.6,
  /** The weighing platform's top (m), and how long a person takes to rise onto it or step off it (s). */
  platformY: 0.05,
  platformRiseSeconds: 0.4,
  /** An unassisted two-reading session is held to this many seconds (the bp gap shrinks to fit), and a vitals-only session to this. */
  fullSessionCapSeconds: 295,
  vitalsSessionCapSeconds: 148,
  /** The BP gap never shrinks below this (s). */
  minBpGapSeconds: 30,
  /** The cuff: share of a reading that inflates, holds, then deflates the rest. */
  cuffRise: 0.3,
  cuffHold: 0.15,
  /** You are taken out of your session if you are further than this from the stand spot (m), after a short grace (s). */
  playerLeaveMetres: 1.5,
  playerGraceSeconds: 2.5,
  /** Your age on the kiosk's screen (the doctor you play; the avatar is a man). */
  playerAge: 38,
  /** Walk-ups on site at once (the line's room is the real limit). */
  maxWalkUps: 10,
  /**
   * The guide's helping spot by kiosk, relative to the stand spot (m): on the outer side of the pair (west of the first platform, east of the second
   * kiosk's stool), level with the platform. The lobby strip is tight, and every other place near a platform lies on somebody's route to it: a spot
   * behind the user's shoulder blocked the first person called (found in the 07:30-12:30 run). guide.test.ts keeps these clear of the nav routes.
   */
  guideOffset: [
    { x: -0.9, z: 0.07 },
    { x: 1.2, z: 0.17 },
  ],
  /** Measurement noise (sd) of each device; the first cuff reading runs a little high (the arm settling). */
  noise: { heightCm: 0.12, weightKg: 0.15, bodyFatPct: 0.8, spo2: 0.5, pulse: 2, bpSys: 4, bpDia: 3, bpFirstExtraSys: 2.5, tempC: 0.1 },
  /** A nurse's manual triage reading: sd of each value. */
  triageNoise: { sys: 4, dia: 3, pulse: 2.5, spo2: 0.5, tempC: 0.12 },
  /** The age of somebody with no age on file (walk-ups, ER arrivals): mean, sd, and the range. */
  age: { mean: 50, sd: 19, min: 18, max: 92 },
  /** Body mass index of the population (research: BMI ~ N(26, 4)) and its limits. */
  bmi: { mean: 26, sd: 4, min: 17, max: 42 },
  /** Hard limits of every true value (display only). */
  limits: { sys: [85, 215], dia: [45, 125], pulse: [42, 155], spo2: [85, 100], tempC: [35.4, 40.6] },
} as const

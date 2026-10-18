/**
 * Simulation tuning ("game balance"): speeds, timings and counts. Owned by the orchestrator.
 * Geometry lives in places.ts; this file holds only numbers that change how the hospital behaves.
 * Times are in sim seconds, distances in metres.
 */
export const CONFIG = {
  sim: {
    step: 1 / 60,
    /** Slow state (clock, counters, events) goes to the stores at this rate. */
    publishHz: 4,
    /** The simulated day starts at 07:30. */
    startHour: 7.5,
    worldSeed: 20261012,
  },

  pods: {
    /** Cruise speed in the corridors and inside the core. */
    corridorSpeed: 1.2,
    coreSpeed: 0.9,
    accel: 0.8,
    decel: 1.2,
    /** Bumper-to-bumper gap kept behind the pod ahead. */
    minGap: 0.45,
    /** Battery use per metre and charge per second in the rank. */
    drainPerMetre: 0.0006,
    chargePerSecond: 0.003,
    /** How long a pod shows the green "delivered" light after leaving the drawer. */
    greenSeconds: 6,
  },

  pharmacy: {
    /** Pharmacist verification of a new order (the simulated safety check). */
    verifySeconds: 8,
    /** Gantry carriage speeds. */
    gantrySpeedX: 1.8,
    gantrySpeedY: 1.4,
    pickSeconds: 1.1,
    dropSeconds: 0.9,
    /** Height the carriage hands packs into a docked pod (W2: the dock ports are at the top of the MedVend face). */
    dropHeight: 2.45,
    /** Closing and locking the compartments before the pod leaves. */
    sealSeconds: 1.5,
  },

  drawers: {
    /** Seconds per pack to transfer from the pod into the drawer. */
    transferSecondsPerItem: 1.2,
    /** Undocking before the pod drives on. */
    undockSeconds: 0.8,
  },

  orders: {
    maxItems: 4,
    /** Rounds orders are due this long after they are written (presenter orders are due at once). */
    roundDoseDelaySeconds: 900,
    /** The nurse is sent when a loaded drawer's dose is due within this many seconds (about her walk time). */
    nurseLeadSeconds: 60,
  },

  people: {
    walkSpeed: 1.3,
    hurrySpeed: 1.9,
    doctorBedsideSeconds: 22,
    /** Doctor pause between rooms. */
    doctorGapSeconds: { min: 20, max: 60 },
    nurseGiveSeconds: 18,
    doctorsPerWard: 1,
    nursesPerWard: 2,
  },

  // ---------------------------------------------------------------------------------------------
  // M3: the emergency department, the people who move through it, and the crowd of the whole hospital.
  // Added by the behaviours builder; the sections above are unchanged.
  // ---------------------------------------------------------------------------------------------

  /** People fade in where they arrive and out where they leave. */
  fade: {
    seconds: 0.6,
  },

  /** How a person gets onto a seat / a trolley / a wheelchair and off again (a short slide, never a pop). */
  transfer: {
    seatSeconds: 0.5,
    vehicleSeconds: 0.8,
  },

  er: {
    /** Walk-in arrivals per hour by clock hour (linear between points; zero after the last). */
    arrivalsPerHour: [
      [7.5, 16],
      [8.5, 26],
      [9.5, 38],
      [10.5, 48],
      [11.5, 42],
      [12.0, 26],
      [12.25, 0],
    ] as readonly (readonly [number, number])[],
    /** A few patients are already at the door in the first minute, so the demo starts alive (sim seconds). */
    openingArrivals: [4, 16, 40, 75] as readonly number[],
    ambulance: {
      /** First ambulance, then one every `every` seconds [min, max]; none after `lastHour`. */
      firstAt: 90,
      every: [720, 1200] as readonly [number, number],
      lastHour: 12.0,
    },
    /** Weights for drawing a walk-in's reason by acuity 1..5. */
    reasonWeightByAcuity: [0.3, 0.7, 2.5, 4, 3] as readonly number[],
    companionChance: 0.35,
    kioskShare: 0.7,
    checkInSeconds: [20, 40] as readonly [number, number],
    triageSeconds: [60, 120] as readonly [number, number],
    /** The nurse's call to the patient before they walk in together. */
    callSeconds: 3,
    examSeconds: [90, 180] as readonly [number, number],
    chartSeconds: [15, 30] as readonly [number, number],
    testsChance: 0.3,
    labSeconds: [60, 90] as readonly [number, number],
    resultsSeconds: [120, 240] as readonly [number, number],
    /** Chance of admission by acuity 1..5 (about 30 % overall). */
    admitChanceByAcuity: [0.9, 0.8, 0.4, 0.12, 0.04] as readonly number[],
    /** Seconds a waiting patient tolerates before leaving, by acuity 1..5 (Infinity: never leaves). */
    patienceSeconds: [
      [Infinity, Infinity],
      [Infinity, Infinity],
      [2500, 2900],
      [1500, 2400],
      [1500, 2400],
    ] as readonly (readonly [number, number])[],
    cleanSeconds: [40, 60] as readonly [number, number],
    handoverSeconds: [15, 25] as readonly [number, number],
    /** A porter takes a patient on or off a vehicle. */
    loadSeconds: 1.2,
    walkSpeed: 1.2,
    wheelSpeed: 1.0,
    /** Staff re-check their job board this often (sim seconds). */
    pollSeconds: 0.4,
  },

  visitors: {
    /** Visiting parties arriving per hour by clock hour (linear between points). */
    partiesPerHour: [
      [7.75, 4],
      [8.5, 16],
      [9.5, 34],
      [10.0, 46],
      [11.5, 46],
      [12.0, 34],
      [12.75, 12],
      [13.5, 0],
    ] as readonly (readonly [number, number])[],
    /** Chance a party is two people, and chance someone carries flowers or a bag. */
    pairChance: 0.35,
    giftChance: 0.4,
    visitSeconds: [600, 1800] as readonly [number, number],
    cafeChance: 0.4,
    cafeSeconds: [300, 900] as readonly [number, number],
    /** Most visitors on site at once (people, not parties). */
    maxOnSite: 34,
    walkSpeed: 1.25,
  },

  ambient: {
    /** Target fill of seats, by group and clock hour (linear between points). */
    lobby: [[7.5, 0.35], [8.5, 0.6], [9.5, 0.88], [10.0, 0.93], [11.5, 0.93], [12.0, 0.8], [13.0, 0.5]] as readonly (readonly [number, number])[],
    cafe: [[7.5, 0.2], [8.5, 0.4], [9.5, 0.65], [10.0, 0.72], [11.5, 0.75], [12.0, 0.6], [13.0, 0.4]] as readonly (readonly [number, number])[],
    benches: [[7.5, 0.1], [9.0, 0.3], [10.0, 0.4], [11.5, 0.4], [12.5, 0.25], [13.0, 0.15]] as readonly (readonly [number, number])[],
    /** How long an ambient person stays seated [min, max] and how often the manager tops the seats up. */
    staySeconds: [480, 2400] as readonly [number, number],
    topUpSeconds: 4,
    walkSpeed: 1.15,
  },

  staffLife: {
    /** Porters sometimes push a linen cart while idle. */
    linenRunChance: 0.35,
    linenDropSeconds: [8, 14] as readonly [number, number],
    /** Cleaners stop to mop this long at a few spots on their patrol. */
    mopSeconds: [10, 20] as readonly [number, number],
    idleGapSeconds: [6, 18] as readonly [number, number],
  },

  /**
   * Imaging (R1). Demo-friendly but real step order; the imaging builder may add keys here. Times in sim seconds.
   * Exam steps and their acquisition times come from src/content/imaging.json.
   */
  imaging: {
    /** MRI: changing into a gown and the metal-safety screening before the scan room. */
    mriPrepSeconds: [150, 240] as readonly [number, number],
    /** Getting onto the table and being positioned (coil, pillows, lasers, gel). */
    positioningSeconds: { mri: [90, 150], ct: [60, 100], xray: [40, 70], us: [30, 50] } as Record<string, readonly [number, number]>,
    /** Table travel into / out of the bore (MRI, CT). */
    tableSeconds: { mri: 14, ct: 8 } as Record<string, number>,
    /** Pause between steps (the radiographer sets up the next sequence, moves the X-ray tube, changes the probe view). */
    betweenStepsSeconds: [6, 14] as readonly [number, number],
    cleanupSeconds: [40, 70] as readonly [number, number],
    /** Images sent, then the report (AI pre-read confirmed by a radiologist, in the demo's ideal hospital). */
    reportSeconds: { mri: [600, 900], ct: [240, 420], xray: [180, 300], us: [120, 240] } as Record<string, readonly [number, number]>,
    /** Outpatients arrive this long before their appointment. */
    outpatientEarlySeconds: [300, 600] as readonly [number, number],
    /** Start-a-scan-now (presenter): the demo outpatient appears at the imaging door. */
    demoArrivalSeconds: 6,

    // --- added by the imaging sim builder (R1) -----------------------------------------------------------------
    /** The share of `mriPrepSeconds` a patient spends in the changing cubicle; the rest is the safety-screening talk. */
    mriChangeShare: 0.6,
    /** CT: cannula and contrast questions; X-ray: ID and pregnancy check; ultrasound: history, consent. Done on the table, before positioning. */
    explainSeconds: { ct: [30, 50], xray: [10, 20], us: [45, 75] } as Record<string, readonly [number, number]>,
    /** The radiographer calls the patient by name before they walk in together (the demo patient is called faster). */
    callSeconds: 2.5,
    demoCallSeconds: 1.2,
    /** A patient changing back into their clothes after an MRI. */
    changeBackSeconds: [20, 35] as readonly [number, number],
    /** An X-ray exposure lasts well under a second; the sim holds the detector read-out for at least this long, and `activity` flashes for the first part. */
    minExposureSeconds: 1.4,
    xrayFlashSeconds: 0.3,
    /** How fast the CT rotor spins up and down (fraction of full speed per second), and the helium-pump level of an idle MRI. */
    ctSpinUpPerSecond: 0.6,
    ctSpinDownPerSecond: 0.45,
    mriIdleActivity: 0.15,
    /** How fast the X-ray tube travels to the wall detector and back (fraction per second). */
    xrayTubePerSecond: 0.4,
    /** The sonographer's probe returns to the start of the next view at this rate (fraction per second). */
    usProbeResetPerSecond: 1.5,
    /** The operator's walking speed estimate when she must leave early to be at the console on time (m/s). */
    operatorWalkEstimate: 1.0,
    /** A step that waits on a person for this long without finishing is forced (the person is placed where they were going) and counted. */
    stuckSeconds: 150,
    /** The metrics window of the utilisation numbers (clock hours). */
    utilisationHours: [7.75, 13.5] as readonly [number, number],
  },

  // ---------------------------------------------------------------------------------------------
  // L1: living day & bed flow (docs/L1-LIVING-DAY.md). Nothing reads these yet: the L1 builders switch the sim over
  // to them, each with its tests. Until then the M3 and R1 tables above run unchanged.
  // ---------------------------------------------------------------------------------------------

  day: {
    /** The simulated day the Jump menu and the full-day curves cover (clock hours). */
    startHour: 6.5,
    endHour: 23.5,
    /** Shift hours [start, end] (night wraps past midnight). */
    shifts: { day: [7.0, 19.0], night: [19.0, 7.0], office: [8.0, 18.0] } as Record<string, readonly [number, number]>,
    /** Arriving staff reach the hub this long before their shift starts; leaving staff go after their handover. */
    arriveEarlySeconds: [300, 600] as readonly [number, number],
    lockerSeconds: [30, 60] as readonly [number, number],
    /** The shift-change huddle at the nurse hub, then a bedside handover per room. */
    huddleSeconds: [180, 300] as readonly [number, number],
    bedsideHandoverSeconds: [15, 25] as readonly [number, number],
    /** The morning safety huddle at each nurse hub (nurses and the coordinator; doctors start rounds). */
    safetyHuddle: { atHour: 7.55, seconds: 240 },
    /** Fewer visitors, softer room light, a calmer lobby. */
    quietHours: [13.0, 14.0] as readonly [number, number],
    /** Night: one nurse per ward, a doctor on call for both wards, circadian lighting. */
    nightHours: [22.0, 6.5] as readonly [number, number],
    nightNursesPerWard: 1,
    nightCheckEverySeconds: 7200,
    nightCheckSeconds: 5,
    /** Idle staff breaks (never while a dose they own is due). */
    breakChancePerHour: 0.35,
    breakSeconds: [300, 900] as readonly [number, number],
    cafeHours: [7.0, 20.0] as readonly [number, number],
    /** Visitors are asked to leave by this hour; at most this many overnight companions per ward stay. */
    visitorsLeaveByHour: 20.5,
    overnightCompanionsPerWard: 1,
    /** A Jump rebuilds the sim at the new hour, then runs this many hidden sim seconds before fading in. */
    jumpPreRollSeconds: 60,
    /** The Jump menu moments (clock hours); their labels live in src/content/day.json. */
    moments: [7.0, 7.75, 9.0, 10.5, 12.0, 15.0, 18.0, 19.0, 22.5] as readonly number[],
    /** Full-day replacements for er.arrivalsPerHour, visitors.partiesPerHour and ambient.* (an evening ER peak; a dip in the quiet hour). */
    erArrivalsPerHour: [
      [6.5, 10], [7.5, 16], [8.5, 26], [9.5, 38], [10.5, 48], [11.5, 42], [12.5, 34], [14.0, 30], [16.0, 30], [18.0, 40], [20.0, 44], [22.0, 30], [23.5, 14],
    ] as readonly (readonly [number, number])[],
    ambulanceLastHour: 23.5,
    visitorPartiesPerHour: [
      [7.75, 4], [8.5, 16], [9.5, 34], [10.0, 46], [11.5, 46], [12.0, 34], [12.75, 12], [13.0, 6], [14.0, 8], [14.5, 30], [15.0, 46], [19.0, 46], [19.5, 24], [20.0, 0],
    ] as readonly (readonly [number, number])[],
    ambient: {
      lobby: [[6.5, 0.2], [7.5, 0.35], [8.5, 0.6], [9.5, 0.88], [10.0, 0.93], [11.5, 0.93], [12.5, 0.8], [13.0, 0.6], [14.0, 0.7], [16.0, 0.85], [19.0, 0.8], [21.0, 0.5], [23.5, 0.3]] as readonly (readonly [number, number])[],
      cafe: [[7.0, 0.15], [7.5, 0.2], [8.5, 0.4], [9.5, 0.65], [10.0, 0.72], [11.5, 0.75], [12.0, 0.9], [13.0, 0.6], [15.0, 0.65], [17.0, 0.5], [19.5, 0.3], [20.0, 0]] as readonly (readonly [number, number])[],
      benches: [[6.5, 0.05], [7.5, 0.1], [9.0, 0.3], [10.0, 0.4], [11.5, 0.4], [12.5, 0.25], [15.0, 0.4], [18.0, 0.3], [20.0, 0.1], [23.5, 0.02]] as readonly (readonly [number, number])[],
    },
    /** Imaging outpatient appointments run between these hours. */
    outpatientHours: [8.0, 17.0] as readonly [number, number],
  },

  beds: {
    /** Planned discharges fall in this window; at least `beforeNoon` of them before 11:00. */
    dischargeHours: [10.0, 16.0] as readonly [number, number],
    beforeNoon: 2,
    /** The family arrives this long after the discharge is signed; changing into everyday clothes in the bathroom pod. */
    familyArrivesSeconds: [300, 900] as readonly [number, number],
    dischargeTeachSeconds: [35, 50] as readonly [number, number],
    changeSeconds: [90, 150] as readonly [number, number],
    /** The cleaner's room clean and the porter's linen change. */
    roomCleanSeconds: [360, 540] as readonly [number, number],
    linenSeconds: [40, 70] as readonly [number, number],
    /** The bed manager may reserve a bed that will be ready within this long; the patient boards in the ER bay meanwhile. */
    reserveWindowSeconds: 1200,
    /** At most this many ER bays board at once, for at most this long; otherwise the patient goes to a ward upstairs. */
    boardingMaxBays: 2,
    boardingMaxSeconds: 1800,
    admissionCheckSeconds: [50, 70] as readonly [number, number],
    /** Stretcher-to-bed slide (also the bed-to-wheelchair transfer). */
    bedTransferSeconds: 0.8,
  },

  meals: {
    /** Serving windows [start, end] (clock hours). */
    windows: { breakfast: [7.75, 8.5], lunch: [12.0, 12.75], dinner: [17.5, 18.25] } as Record<string, readonly [number, number]>,
    /** The collection run starts this long after a room was served. */
    collectAfterSeconds: 2400,
    botsPerWard: 2,
    spareBots: 1,
    shelves: 8,
    botSpeed: 0.8,
    botAccel: 0.5,
    /** A bot stops when a person is this close ahead of it. */
    yieldDistance: 1.2,
    /** The host takes a tray from the cabinet, carries it in and sets it on the over-bed table. */
    serveSeconds: [12, 20] as readonly [number, number],
    cabinetDoorSeconds: 0.6,
    /** Raising or lowering the bed head. */
    reclineSeconds: 6,
    eatSeconds: [900, 1500] as readonly [number, number],
  },

  /** Fixed dose waves (L1): orders for each occupied room's regular medicines, this long before each dose hour. */
  doseWaves: {
    hours: [12.0, 18.0, 22.0] as readonly number[],
    leadSeconds: 1800,
  },

  /** Walk-in (W1): you, the doctor. Distances in metres, times in seconds, angles in degrees. */
  player: {
    /** A brisk walk by default (game feel, still a person), and a real run on Shift. */
    walkSpeed: 2.0,
    hurrySpeed: 4.2,
    /**
     * W3: speed changes are critically damped (no overshoot). Seconds to 95 % of the change; the spring's smoothTime is s / 2.37.
     * Starting from rest (walk or run) peaks about 10 m/s^2; a stop from a walk takes about 0.24 m, from a run about 0.5 m.
     */
    startSeconds: 0.35,
    stopSeconds: 0.28,
    /** Walk <-> run (Shift pressed or released), and backing up. */
    shiftSeconds: 0.45,
    /** W3: your body stops this short of every solid (metres): the collide-and-slide skin. */
    bodySkin: 0.01,
    /** W3: doors sense you this far ahead along your velocity (seconds), so a 4.2 m/s run meets an open door. */
    doorLeadSeconds: 0.6,
    turnSeconds: 0.12,
    /** Collision radius against walls and furniture, and the proxy NPCs steer around. */
    bodyRadius: 0.3,
    crowdRadius: 0.45,
    camera: {
      /** The pivot: just above head height, and this far right of it (GTA over-the-shoulder). */
      pivotHeight: 1.62,
      shoulder: 0.45,
      boom: 3.0,
      boomMin: 0.15,
      boomMax: 4.5,
      /** Zooming in past this boom switches to first person; under `hideAvatarBelow` the avatar fades out. */
      firstPersonBelow: 1.15,
      hideAvatarBelow: 0.75,
      pitchDeg: -8,
      fovDeg: 60,
      fovFirstDeg: 72,
      eyeHeight: 1.65,
      /** The camera's near plane while walking (the overview keeps 1). */
      near: 0.1,
      /** Seconds of the walk <-> overview flight. */
      modeFlightSeconds: 0.9,
    },
    /** E reaches this far, within this angle either side of where you face. */
    reach: 2.0,
    reachHalfAngleDeg: 55,
    /** NPCs within this distance turn their heads to you; staff greet you at most once per cooldown. */
    noticeRadius: 3.5,
    greetRadius: 2.5,
    greetCooldownSeconds: 60,
    /** Someone you talk to stops, faces you and holds this long. */
    talkHoldSeconds: 5,
  },
} as const

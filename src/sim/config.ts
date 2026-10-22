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
    /** S1: steps per frame are capped at max(maxStepsMin, ceil(speed × 2.2)) and by a wall-clock budget; leftover time is dropped. */
    maxStepsMin: 40,
    stepBudgetMs: 6,
  },

  /**
   * S1 "Showcase" (docs/S1-SHOWCASE.md): the opening and every warm start (Jump, Skip) place work already under way, so
   * each machine and room has someone at work. The people are placed, then a hidden pre-roll carries them mid-way.
   */
  opening: {
    /** The showcase opening's hidden pre-roll at 07:30 (the clock still reads 07:30 when it fades in). */
    preRollSeconds: 50,
    /** ER patients placed: waiting for triage, waiting for a doctor, already in an ER bay. */
    er: { triage: 2, doctor: 2, bay: 2 },
    /** Walk-ups on the health kiosks (one: the other is left free for the presenter to show), chairs mid-draw, tubes put on the lab track. */
    kiosks: 1,
    /**
     * The kiosk left free is kept for you: no walk-up or ER patient is called to it for this long after a warm start (sim seconds), or until
     * your own session there has ended, so the presenter can always walk up and show how it works.
     */
    kioskHoldSeconds: 1800,
    drawChairs: 3,
    labTubes: 5,
    /** How far through its current sequence each scanner is when placed (share, uniform). */
    seqProgress: [0.4, 0.7] as readonly [number, number],
    /** Early visitor parties placed at a showcase opening (the lounges fill). */
    visitorParties: 3,
  },

  /** S1: going forward in time. Short skips run the same hospital headless; longer ones rebuild it at the target (a forward Jump). */
  skip: {
    /** The plain skip buttons (seconds): +15 min and +1 h. */
    steps: [900, 3600] as readonly number[],
    /** At or under this, a skip runs the live hospital forward (full continuity); above it, a rebuild. */
    liveMaxSeconds: 180,
    /** A milestone skip lands this long before the event, so you see it start. */
    milestoneLeadSeconds: 20,
    /** The time-lapse veil and the fade back in (ms). */
    lapseMs: 700,
    fadeInMs: 450,
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
    /**
     * Wave 1 "A real clinical day": the ward round is once each morning, with the nurse, 6-10 minutes a bed (real ward rounds: 5-15 min a
     * patient); a short afternoon review of patients admitted since; an on-call doctor at night. At a round visit the doctor changes the
     * patient's medicines only sometimes (`changeChance`); the regular doses go out by dose time (`doseWaves`, content/medicines.json).
     */
    round: {
      startHour: 8.5,
      endHour: 11.0,
      bedsideSeconds: [360, 600] as readonly [number, number],
      gapSeconds: [60, 180] as readonly [number, number],
      afternoonHour: 15.0,
      reviewSeconds: [240, 420] as readonly [number, number],
      changeChance: 0.25,
    },
    /** Walking speed factor by age (piecewise linear: [age, factor]): an 88-year-old walks at about 0.75 of a young adult's pace. */
    ageWalkFactor: [
      [0, 1.0],
      [60, 1.0],
      [70, 0.9],
      [80, 0.78],
      [90, 0.68],
    ] as readonly (readonly [number, number])[],
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
    /**
     * Walk-in arrivals per hour by clock hour (linear between points; zero after the last). Wave 1: sized to 6 bays and 2 doctors at real
     * durations (a doctor sees about 1.5-2.5 patients an hour; a majors bay is occupied 2-4 h); was a 48-an-hour peak.
     */
    arrivalsPerHour: [
      [7.5, 3],
      [8.5, 4],
      [9.5, 5],
      [10.5, 6.5],
      [11.5, 5.5],
      [12.0, 4],
      [12.25, 0],
    ] as readonly (readonly [number, number])[],
    /** A few patients are already at the door in the first minute, so the demo starts alive (sim seconds). */
    openingArrivals: [4, 16, 40, 75] as readonly number[],
    ambulance: {
      /** First ambulance, then one every `every` seconds [min, max]; none after `lastHour`. */
      firstAt: 90,
      every: [2400, 4200] as readonly [number, number],
      lastHour: 12.0,
    },
    /** Weights for drawing a walk-in's reason by acuity 1..5. */
    reasonWeightByAcuity: [0.3, 0.7, 2.5, 4, 3] as readonly number[],
    companionChance: 0.35,
    kioskShare: 0.7,
    checkInSeconds: [20, 40] as readonly [number, number],
    /** Real durations (Wave 1): triage 3-7 min, the doctor's assessment 10-20 min, the review of the results 3-7 min. */
    triageSeconds: [180, 420] as readonly [number, number],
    /** The nurse's call to the patient before they walk in together. */
    callSeconds: 3,
    examSeconds: [600, 1200] as readonly [number, number],
    reviewSeconds: [180, 420] as readonly [number, number],
    /** At the bay, before the doctor: the ER nurse's observations, cannula, ECG and bedside bloods (the tubes go by pneumatic tube). */
    bayCareSeconds: [180, 360] as readonly [number, number],
    chartSeconds: [15, 30] as readonly [number, number],
    /** A minor complaint with no tests is seen and treated quickly (6-12 min), after observations only (this share of the care step). */
    minorExamSeconds: [360, 720] as readonly [number, number],
    minorCareShare: 0.4,
    /** Priority 1-2 need more of the nurse and the doctor (monitor, oxygen, a second line; a longer, more careful assessment). */
    seriousScale: 1.4,
    /** A world with no lab (a bare test world): the bedside bloods come back after this long. */
    resultsSeconds: [1200, 2400] as readonly [number, number],
    /** Chance of admission by acuity 1..5, drawn AFTER the results (Wave 1: priority 1-2 are nearly always admitted). */
    admitChanceByAcuity: [1.0, 0.95, 0.45, 0.1, 0.03] as readonly number[],
    /** Seconds a waiting patient tolerates before leaving, by acuity 1..5 (Infinity: never leaves). */
    patienceSeconds: [
      [Infinity, Infinity],
      [Infinity, Infinity],
      [3600, 9000],
      [2400, 7200],
      [2400, 7200],
    ] as readonly (readonly [number, number])[],
    /** A bay clean between patients (5-10 min) and the paramedics' handover to the ER nurse (2-4 min). */
    cleanSeconds: [300, 600] as readonly [number, number],
    handoverSeconds: [120, 240] as readonly [number, number],
    /** A porter takes a patient on or off a vehicle. */
    loadSeconds: 1.2,
    walkSpeed: 1.2,
    wheelSpeed: 1.0,
    /** Staff re-check their job board this often (sim seconds). */
    pollSeconds: 0.4,
  },

  visitors: {
    /** Visiting parties arriving per hour by clock hour (linear between points). */
    /** Wave 1: visiting from 11:00 (after the morning round and handover), none before. */
    partiesPerHour: [
      [11.0, 4],
      [11.5, 16],
      [12.0, 26],
      [12.75, 22],
      [13.5, 0],
    ] as readonly (readonly [number, number])[],
    /** Chance a party is two people, and chance someone carries flowers or a bag. */
    pairChance: 0.35,
    giftChance: 0.4,
    /** Wave 1: a real bedside visit, 15-40 minutes (was 10-30). */
    visitSeconds: [900, 2400] as readonly [number, number],
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
    reportSeconds: { mri: [2400, 4800], ct: [1200, 2700], xray: [900, 1800], us: [600, 1200] } as Record<string, readonly [number, number]>,
    /** Wave 1: a contrast CT's portal-venous phase follows the arterial one 35-45 s later (not the generic step gap). */
    ctPhaseGapSeconds: [35, 45] as readonly [number, number],
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
    utilisationHours: [7.75, 17.0] as readonly [number, number],
  },

  // ---------------------------------------------------------------------------------------------
  // W4: smart diagnostics (docs/W4-DIAGNOSTICS.md). Seconds unless named; ranges are [min, max] seeded draws. Sources in the comments.
  // ---------------------------------------------------------------------------------------------

  /** Entrance health kiosks (China 健康一体机 / 智能健康小屋): ID/insurance card or WeChat QR login; whole session 3-5 min; 20-60 sessions a day
   *  per station with a morning peak; one attendant helps the elderly (Nanjing/Shanghai/Beijing reports, SiSU). */
  vitals: {
    loginSeconds: [12, 30] as readonly [number, number],
    heightSeconds: [4, 6] as readonly [number, number],
    weightSeconds: [3, 5] as readonly [number, number],
    bodyFatSeconds: [10, 15] as readonly [number, number],
    sitSeconds: [3, 5] as readonly [number, number],
    /** Finger clip; doubles as the seated rest before the cuff. */
    spo2Seconds: [20, 40] as readonly [number, number],
    /** Arm-tunnel cuff (Omron HBP-9020 style), about a minute per reading. */
    bpSeconds: [45, 65] as readonly [number, number],
    bpReadingsFull: 2,
    bpGapSeconds: 60,
    /** If two readings disagree by more than this (systolic, mmHg), a third after a 3-minute rest (PUMCH guidance). */
    bpRepeatDeltaSys: 10,
    bpRepeatRestSeconds: 180,
    tempSeconds: [2, 4] as readonly [number, number],
    reportSeconds: [8, 12] as readonly [number, number],
    screenHoldSeconds: 8,
    assistAge: 75,
    assistChance: 0.15,
    assistFactor: 1.3,
    /** Waiting-area readings run 10-30 mmHg below the consulting room (the white-coat effect, PUMCH): a per-person offset added at triage. */
    whiteCoatSys: [0, 30] as readonly [number, number],
    whiteCoatDiaShare: 0.4,
    /** ER walk-ins: who stops at a kiosk on the way to the triage wait (vitals-only session, one cuff reading). */
    erMinAcuity: 3,
    erUseChance: 0.35,
    erMaxAhead: 1,
    /** Triage takes this share of its time when kiosk vitals are already in the record. */
    triageWithVitalsFactor: 0.8,
    /** Walk-up health checks per hour PER KIOSK, by clock hour (piecewise linear): about 35 a day per kiosk (field: 20-60). */
    walkUpsPerHour: [
      [7.0, 2],
      [8.0, 6],
      [9.5, 6],
      [11.0, 3],
      [13.0, 2],
      [17.0, 2],
      [19.0, 0],
    ] as readonly (readonly [number, number])[],
    /** Your own session (E at a kiosk) is a short demo. */
    playerSessionSeconds: 40,
  },

  /** Robot blood-draw centre. MagicNurse/迈纳士 (NMPA Class III 2019, Zhongshan Hospital): 205 s for 4 tubes, 94.3 % of 6,016 patients;
   *  Vitestro Aletta: median 2:37 start-to-bandage, 94.5 % first stick when a vein was found, ~6 % no suitable vein -> manual, haemolysis
   *  0.3 %, one supervisor per 3 robots. Draw-centre flow (Guangdong, Taihu, Fudan Cancer): ticket -> call -> tube prep (BC-ROBO 10-12 s) ->
   *  draw -> pneumatic; peak 07:30-09:30. */
  blood: {
    outpatientHours: [7.0, 17.0] as readonly [number, number],
    outpatientsPerHour: [
      [7.0, 14],
      [7.5, 28],
      [8.5, 30],
      [9.5, 20],
      [10.5, 10],
      [12.0, 6],
      [14.0, 6],
      [16.5, 3],
      [17.0, 0],
    ] as readonly (readonly [number, number])[],
    robotsPerNurse: 3,
    checkInSeconds: [10, 20] as readonly [number, number],
    prepSeconds: [10, 12] as readonly [number, number],
    callRepeatSeconds: 45,
    stuckSeconds: 300,
    priorityAge: 80,
    cardScanSeconds: [3, 6] as readonly [number, number],
    armInSeconds: [8, 14] as readonly [number, number],
    cuffSeconds: [10, 15] as readonly [number, number],
    sanitiseSeconds: [20, 30] as readonly [number, number],
    veinScanSeconds: [15, 35] as readonly [number, number],
    needleInSeconds: [6, 10] as readonly [number, number],
    inversionSeconds: 1.1,
    fillSeconds: {
      citrate: [10, 14],
      serum: [14, 20],
      heparin: [12, 18],
      EDTA: [10, 14],
      fluoride: [8, 12],
    } as Readonly<Record<'citrate' | 'serum' | 'heparin' | 'EDTA' | 'fluoride', readonly [number, number]>>,
    needleOutSeconds: [4, 6] as readonly [number, number],
    bandageSeconds: [8, 12] as readonly [number, number],
    releaseSeconds: [6, 10] as readonly [number, number],
    resetSeconds: [10, 15] as readonly [number, number],
    noVeinChance: 0.06,
    firstStickMissChance: 0.055,
    maxRobotAttempts: 2,
    armMoveChance: 0.015,
    /** Manual draw by the supervising nurse: 52 s for 4 tubes by hand (Zhongshan) plus her preparation. */
    manualDrawSeconds: [55, 90] as readonly [number, number],
    reassureSeconds: [15, 30] as readonly [number, number],
    /** Contrast-CT outpatients arrive this much earlier for a creatinine draw. */
    preScanLeadSeconds: 3000,
    /** Safety nets so a stalled draw or lab can never strand an ER patient: give up waiting for the draw, and for the results (the lab takes 16-22 min). */
    drawFallbackSeconds: 900,
    resultsFallbackSeconds: 2700,
  },

  /** The automated lab (Roche cobas / Mindray MT 8000 / Sysmex XN-9100 style). Single-tube pneumatic about 10 m/s (Wenling). Centrifuge 5-10
   *  min. Field turnaround: blood count ~30 min, chemistry 40-60, immunoassay 60-120; next door, on a track, with auto-verification, faster. */
  lab: {
    sendGapSeconds: 2.5,
    receiveSeconds: 1.5,
    sortSeconds: [3, 5] as readonly [number, number],
    cameraSeconds: 2,
    haemolysisChance: 0.003,
    trackSpeed: 0.25,
    puckGap: 0.12,
    centrifugeCapacity: 24,
    spinSeconds: { stat: 300, routine: 420 } as Readonly<Record<'stat' | 'routine', number>>,
    loadSecondsPerTube: 2,
    routineBatchMaxWaitSeconds: 600,
    decapSeconds: 2.5,
    recapSeconds: 2.5,
    /** Seconds per aspiration (a blood count analyser does about 100 an hour). */
    aspirateSeconds: { haematology: 36, chemistry: 4.5, immunoassay: 20, coagulation: 30 } as Readonly<Record<'haematology' | 'chemistry' | 'immunoassay' | 'coagulation', number>>,
    autoVerifyShare: 0.85,
    reviewSeconds: { stat: [45, 120], routine: [90, 420] } as Readonly<Record<'stat' | 'routine', readonly [number, number]>>,
    archiveCapacity: 3000,
    /** Ward samples arriving through the riser (drawn at the bedside, not modelled), per hour by clock hour. */
    backgroundPerHour: [
      [6.0, 10],
      [7.0, 30],
      [9.0, 20],
      [12.0, 10],
      [18.0, 8],
      [23.5, 4],
    ] as readonly (readonly [number, number])[],
    /** Target turnaround (minutes, draw to verified result) per analyser: the tests check 95 % fall inside. */
    tatTargetMinutes: { haematology: [2, 20], chemistry: [12, 45], immunoassay: [15, 60], coagulation: [8, 40] } as Readonly<
      Record<'haematology' | 'chemistry' | 'immunoassay' | 'coagulation', readonly [number, number]>
    >,
  },

  // ---------------------------------------------------------------------------------------------
  // R2: robotic surgery on level 2 (docs/R2-SURGERY.md): one da Vinci 5 OR with pre-op, recovery and the lifts. Sources:
  //  - Intuitive, FDA 510(k) clearance of da Vinci 5 (14 March 2024): Xi-style patient cart, force feedback, integrated insufflation.
  //  - Xi system readiness guide (PN 1004943 rev G): patient cart 0.98 x 1.49 m, 1.74-2.47 m, 821 kg; console 0.97 x 0.86 m.
  //  - Draping and docking on the Xi, 65 cases: draping 5.6 min, docking 7.8 min, about 5 and 7 after the learning curve (PMC7674320).
  //  - Console times: robotic cholecystectomy 15.1 min, set-up 11.9 (World J Gastroenterol 2013;19:3077); simple hysterectomy 125 min,
  //    docking 7 (Int J Womens Health 2011, PMC3150207); prostatectomy 180-198 min console, 222-295 operative (IBJU, 177 patients) and
  //    51 % of 500 men at 121-180 min.
  //  - OR size 600-650 sq ft clear floor (FGI 2014, as reported for hybrid and robotic rooms): the OR here is 72 m^2.
  // ---------------------------------------------------------------------------------------------

  surgery: {
    /** The theatre list: the first patient is wheeled in at this hour; no case starts after lastStartHour. */
    firstInHour: 8.0,
    lastStartHour: 15.5,
    /** The day's list, one template picked by the seed. */
    templates: [
      ['cholecystectomy', 'hysterectomy', 'cholecystectomy'],
      ['prostatectomy', 'cholecystectomy'],
      ['cholecystectomy', 'cholecystectomy', 'hysterectomy'],
      ['hysterectomy', 'cholecystectomy'],
    ] as readonly (readonly ('cholecystectomy' | 'hysterectomy' | 'prostatectomy')[])[],
    /** A patient arrives this long before their planned wheels-in (minutes, uniform). */
    arriveBeforeMinutes: [60, 90] as readonly [number, number],
    /** Room time, wheels-in to wheels-out (minutes), and the console time inside it, per procedure. */
    roomMinutes: { cholecystectomy: [60, 90], hysterectomy: [120, 180], prostatectomy: [120, 180] } as Readonly<
      Record<'cholecystectomy' | 'hysterectomy' | 'prostatectomy', readonly [number, number]>
    >,
    consoleMinutes: { cholecystectomy: [15, 30], hysterectomy: [75, 110], prostatectomy: [95, 130] } as Readonly<
      Record<'cholecystectomy' | 'hysterectomy' | 'prostatectomy', readonly [number, number]>
    >,
    /** The other theatre phases (minutes): drawn, then scaled together so the room time comes out as drawn. */
    phaseMinutes: {
      in: [3, 5],
      induction: [8, 12],
      positioning: [6, 12],
      ports: [5, 8],
      docking: [5, 8],
      undocking: [2, 3],
      closing: [6, 12],
      emergence: [6, 10],
      out: [3, 5],
    } as Readonly<Record<'in' | 'induction' | 'positioning' | 'ports' | 'docking' | 'undocking' | 'closing' | 'emergence' | 'out', readonly [number, number]>>,
    /** Draping the four arms of the parked cart before the patient comes in (minutes). */
    drapeMinutes: [5, 6] as readonly [number, number],
    /** Cleaning and resetting the room between cases (minutes). */
    turnoverMinutes: [25, 35] as readonly [number, number],
    /** Pre-op in the bay: gown, nurse checks, the anaesthetist's and the surgeon's visits (minutes each). */
    preOpMinutes: { gown: [5, 8], nurse: [8, 12], anaesthetist: [5, 8], surgeon: [3, 6] } as Readonly<
      Record<'gown' | 'nurse' | 'anaesthetist' | 'surgeon', readonly [number, number]>
    >,
    /** Recovery in PACU, then (day cases) the second stage in a lounge recliner before going home (minutes). */
    pacuMinutes: [45, 90] as readonly [number, number],
    phase2Minutes: [30, 60] as readonly [number, number],
    /** Share of each procedure's patients who go home the same day; the rest go up to the surgical ward. Seeded per case. */
    homeShare: { cholecystectomy: 0.9, hysterectomy: 0.5, prostatectomy: 0 } as Readonly<Record<'cholecystectomy' | 'hysterectomy' | 'prostatectomy', number>>,
    /** Instrument exchanges at the bedside during the console phase (per hour, uniform). */
    exchangesPerHour: [6, 12] as readonly [number, number],
    /** The insufflation pressure shown at the console (mmHg; display only). */
    insufflationMmHg: 12,
    /** The theatre team is on level 2 from teamFromHour to teamToHour. */
    teamFromHour: 7.0,
    teamToHour: 18.5,
    /**
     * S1 showcase opening: an early cholecystectomy still in PACU, a hysterectomy at the console at anchorHour, then the
     * seeded template (shifted, same draws). The next patient is in a pre-op bay from nextBayHour.
     */
    showcase: {
      anchorHour: 7.5,
      consoleElapsedMinutes: [8, 14] as readonly [number, number],
      early: 'cholecystectomy' as const,
      atConsole: 'hysterectomy' as const,
      pacuLeftMinutes: [15, 25] as readonly [number, number],
      nextBayHour: 7.3,
    },
  },

  /** R2: the lifts, now real for level 2 (level 3+ is still "upstairs": the ER and ward fades are unchanged). */
  lifts: {
    /** Cars per shaft (A north, B south). */
    carsPerShaft: 2,
    doorSeconds: 3,
    /** Doors stay open this long for a boarding or leaving party. */
    dwellSeconds: 4,
    /** Seconds per floor: a bed lift at about 1 m/s over the 4.2 m storey, with starting and stopping. */
    travelSeconds: 6,
    /** One party per car per trip: a stretcher (or wheelchair) party, or up to this many walkers. */
    walkersPerCar: 6,
    /** A lobby holds at most one stretcher party and this many waiting walkers. */
    lobbyWalkers: 4,
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
    /** The first quiet check of the night (22:30, so the 22:30 Jump shows it), then every `nightCheckEverySeconds` while it is night. */
    nightCheckFirstHour: 22.5,
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
    moments: [7.0, 7.75, 8.75, 9.0, 10.5, 12.0, 15.0, 18.0, 19.0, 22.5] as readonly number[],
    /** Full-day replacements for er.arrivalsPerHour, visitors.partiesPerHour and ambient.* (an evening ER peak; a dip in the quiet hour). */
    erArrivalsPerHour: [
      [6.5, 2], [7.5, 3], [8.5, 4], [9.5, 5], [10.5, 6.5], [11.5, 5.5], [12.5, 5], [14.0, 5], [16.0, 5], [18.0, 6], [20.0, 6], [22.0, 3], [23.5, 2],
    ] as readonly (readonly [number, number])[],
    ambulanceLastHour: 23.5,
    visitorPartiesPerHour: [
      [11.0, 4], [11.5, 16], [12.0, 26], [12.75, 20], [13.0, 6], [14.0, 8], [14.5, 30], [15.0, 40], [19.0, 40], [19.5, 20], [20.0, 0],
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
    familyArrivesSeconds: [1800, 5400] as readonly [number, number],
    dischargeTeachSeconds: [35, 50] as readonly [number, number],
    changeSeconds: [90, 150] as readonly [number, number],
    /** The cleaner's room clean and the porter's linen change. */
    roomCleanSeconds: [1800, 2700] as readonly [number, number],
    linenSeconds: [40, 70] as readonly [number, number],
    /** The bed manager may reserve a bed that will be ready within this long; the patient boards in the ER bay meanwhile. */
    reserveWindowSeconds: 1200,
    /** At most this many ER bays board at once, for at most this long; otherwise the patient goes to a ward upstairs. */
    boardingMaxBays: 2,
    boardingMaxSeconds: 1800,
    /** The nurse's admission assessment of a new patient (Wave 1: 25-40 min; was about a minute). */
    admissionCheckSeconds: [1500, 2400] as readonly [number, number],
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

  /**
   * Fixed dose waves (L1; Wave 1: the hospital's medicine rounds): orders for each occupied room's medicines DUE at that hour (each medicine's
   * dose times are in content/medicines.json), this long before each dose hour. The 08:00 round is the biggest of the day.
   */
  doseWaves: {
    hours: [8.0, 12.0, 14.0, 18.0, 22.0] as readonly number[],
    leadSeconds: 1800,
  },

  /** Walk-in (W1): you, the doctor. Distances in metres, times in seconds, angles in degrees. */
  player: {
    /** An ordinary person's walk by default (1.4 m/s, the walk everybody in the hospital has), and a natural run on Shift (a jog, not a sprint). */
    walkSpeed: 1.4,
    hurrySpeed: 3.6,
    /**
     * W3: speed changes are critically damped (no overshoot). Seconds to 95 % of the change; the spring's smoothTime is s / 2.37.
     * Starting from rest peaks about 7 m/s^2 into a walk; a stop from a walk takes about 0.16 m, from a run about 0.42 m.
     */
    startSeconds: 0.35,
    stopSeconds: 0.28,
    /** Walk <-> run (Shift pressed or released), and backing up. */
    shiftSeconds: 0.45,
    /** W3: your body stops this short of every solid (metres): the collide-and-slide skin. */
    bodySkin: 0.01,
    /** W3: doors sense you this far ahead along your velocity (seconds), so a running body meets an open door. */
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

// before/after shots: [name, x, z, lookX, lookZ] in sim metres (level 2: x + 150)
window.__baShots = [
  ['1-er-hall', -49.6, 6.7, -55.5, 20.5],
  ['2-er-station', -51.2, 14.6, -56.8, 7.0],
  ['3-patient-room', -13.9, -16.4, -12.0, -21.5],
  ['4-ward-corridor', -37.5, -14.35, 36.0, -14.0],
  ['5-imaging', -39.2, 0.0, -22.0, 0.0],
  ['6-recovery-l2', 105.1, 13.4, 99.0, 21.2],
  ['7-lobby-desk', -48.5, 1.5, -51.5, -3.0],
  ['8-command', -13.0, -9.8, -19.5, 3.0],
]
window.__baGo = (i) => { const [n, x, z, lx, lz] = window.__baShots[i]; const y = Math.atan2(lx - x, lz - z); window.__hospitalPlayer.place(x, z, y); window.__hospitalPlayer.look(y, 0); setTimeout(() => window.__hospitalPlayer.look(y, 0), 2500); return n }

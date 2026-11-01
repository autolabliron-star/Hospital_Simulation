/**
 * R5 "Watch step by step" (docs/R5-PROCEDURES.md): the watch camera. See director.ts for what it does, shots.ts for the shots, and src/ui/watch for the
 * overlay and the room panels' button.
 */
export { WatchCamera } from './WatchCamera'
export { WatchDirector } from './director'
export { registerWatchSession, useWatch, watchLive, watchSession, watchingNow } from './watch.store'
export type { FreeLook, WatchMode, WatchPhase, WatchRequest, WatchSession, WatchStatus, WatchUiState } from './watch.store'
export { WATCH_ROOMS, proceduresOfRoom, roomOfProcedure, roomPort, roomView } from './rooms'
export type { WatchRoomId, WatchSim } from './rooms'

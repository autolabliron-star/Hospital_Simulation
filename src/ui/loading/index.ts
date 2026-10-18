/**
 * The loading screen: `<LoadingScreen />` mounts once in App.tsx, after the HUD. See LoadingScreen.tsx.
 * The state it follows (`ready`, `progress`, `entered`) is `useWarmup` from src/scene/warmup.
 */
export { LoadingScreen, LoadingCard } from './LoadingScreen'
export { loadingView, FADE_MS, GIVE_UP_MS, type LoadingView, type LoadingInput } from './loadingModel'
export { introFlags, holdSim, enterHospital, type IntroPorts } from './intro'

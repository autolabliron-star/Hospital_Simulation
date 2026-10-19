/**
 * The instanced crowd: the public API of src/scene/actors.
 *
 *   <People />                          mount once inside the <Canvas>
 *   pickPerson(raycaster)               the entity id under a ray, or null (capsule test; for the M4 click / follow UI)
 *   setSelectedPerson(id) / setFollowedPerson(id) / setHoveredPerson(id)
 *                                       rim light on the person, plus a ground ring for the followed (else selected) one
 *   headPosition(entity, out)           centre of the head (standing, seated or lying), crownPosition for emotes and bubbles
 *   lookFor, OUTFIT_NAMES, TONE         what everyone wears (src/scene/actors/crowd/outfit.ts is the one place for colours)
 *   VEHICLE_AHEAD                       how far in front of the pusher each vehicle's origin is (a sim placing riders can use it)
 *   CONSOLE_HANDS                       R2: where the two hands of a surgeon at a console rest (the console model puts its hand controllers there)
 *   THEATRE_NAME                        R2: what the 'theatre' outfit is, in words (scrubs and a cap)
 *
 * R2: the crowd draws the sim's flat plan on two storeys (src/sim/levels.ts): `People` maps every entity by its level and draws only who the screen shows
 * (src/scene/levels). Slots, pose rows and the look-at are drawn coordinates; `headPosition`/`crownPosition` stay SIM points (map them with `toDisplayInto`).
 */
export { People } from './crowd/CrowdRenderer'
export { highlight, pickPerson, setFollowedPerson, setHoveredPerson, setSelectedPerson } from './crowd/runtime'
export { HEAD_HEIGHT, crownPosition, headPosition, levelsOf, sizeOf } from './crowd/head'
export { EVERYDAY_NAME, GOWN_NAME, OUTFIT_NAMES, THEATRE_NAME, TONE, clothesOf, heightFor, lookFor, scaleFor, type Look } from './crowd/outfit'
export { CONSOLE_HANDS } from './crowd/armIn'
export { LOD, lodBounds, lodWeights } from './crowd/lod'
export { VEHICLE, VEHICLE_AHEAD, PROP } from './crowd/constants'
export { HANDLE } from './crowd/pose'

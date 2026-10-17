import { PodsLayer } from './PodsLayer'
import { RailLayer } from './RailLayer'

/** The ceiling rail and the MedPods that hang from it. */
export function Robots() {
  return (
    <>
      <RailLayer />
      <PodsLayer />
    </>
  )
}

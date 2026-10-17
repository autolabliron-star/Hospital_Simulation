/**
 * `RigControls` is camera-controls (the overview camera) with one thing the stock class does not offer: a `suspended` switch.
 * While it is true `update()` does nothing at all, which hands the camera to the player's chase camera without unmounting
 * anything (drei's `<CameraControls>` calls `update` every frame at priority -1, after the player at -10 has written the camera).
 *
 * App.tsx passes this class as `<CameraControls impl={RigControls} />`. The player system suspends it (and disables its pointer
 * and wheel handling) for the whole of walk mode and the two flights, and on the way back hands the camera pose over with
 * `setLookAt(position, target, false)` before waking it.
 */
import CameraControlsImpl from 'camera-controls'

export class RigControls extends CameraControlsImpl {
  /** While true, `update()` is a no-op and the camera belongs to someone else. */
  suspended = false

  override update(delta: number): boolean {
    if (this.suspended) return false
    return super.update(delta)
  }
}

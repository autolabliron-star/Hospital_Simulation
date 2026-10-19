/**
 * The overview's Level switch (R2): "Level 1 | Level 2 · Surgery", a small segmented control under the clock card (top left), with the line that says
 * what the shown level holds and the L key. It exists in the overview only: walking, you are on your level and the lifts change it. The choice is
 * `useOverviewLevel` (src/scene/levels), set through `chooseLevel` (src/scene/camera/roomFocus.ts), which also lets go of a room panel that sits on
 * the other level. The words are src/content/surgeryUi.json `level`; the key is `levelKey.ts`, installed by the HUD root. Same look as the speed control.
 */
import { chooseLevel } from '@/scene/camera/roomFocus'
import { useOverviewLevel } from '@/scene/levels/levelView'
import { SURGERY_UI } from '@/content/surgeryUi'
import type { LevelId } from '@/sim/levels'
import { captionOf, levelOptions } from './levelSwitchModel'
import './levelSwitch.css'

export interface LevelSwitchViewProps {
  level: LevelId
  onChoose(level: LevelId): void
}

/** The markup, with the state as props (so it renders in node, and the HUD test can read it). */
export function LevelSwitchView({ level, onChoose }: LevelSwitchViewProps) {
  return (
    <div className="hud-card hud-level" data-level={level}>
      <div className="hud-seg hud-level__seg" role="group" aria-label={SURGERY_UI.level.aria}>
        {levelOptions().map((o) => (
          <button
            key={o.level}
            type="button"
            className="hud-seg__btn hud-level__btn"
            aria-pressed={level === o.level}
            title={`${o.label} (key L)`}
            onClick={(e) => {
              onChoose(o.level)
              e.currentTarget.blur()
            }}
          >
            {o.label}
          </button>
        ))}
      </div>
      <p className="hud-level__caption" aria-live="polite">
        <span className="hud-level__text">{captionOf(level)}</span>
        <kbd className="hud-kbd" aria-hidden="true">
          L
        </kbd>
      </p>
    </div>
  )
}

export function LevelSwitch() {
  const level = useOverviewLevel((s) => s.level)
  return <LevelSwitchView level={level} onChoose={chooseLevel} />
}

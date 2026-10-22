import { Component, type ErrorInfo, type ReactNode } from 'react'

export interface ErrorBoundaryProps {
  /** Which part of the page this guards (logged with the error). */
  name: string
  /** Shown instead of the children after a throw. `null` (the default) makes the part disappear and leaves the rest of the page alive. */
  fallback?: ReactNode
  children?: ReactNode
}

interface ErrorBoundaryState {
  error: unknown
  failed: boolean
}

/**
 * F-01: one throwing panel must not blank the page. React unmounts the whole root when nothing catches a render error, so every HUD group
 * and the Canvas sit inside one of these. The fallback is `null` for a HUD group (it just goes away) and a Reload card for the Canvas.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null, failed: false }

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error, failed: true }
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error(`The "${this.props.name}" part crashed and was replaced by its fallback.`, error, info.componentStack)
  }

  override render(): ReactNode {
    if (this.state.failed) return this.props.fallback ?? null
    return this.props.children
  }
}

/** The fallback for the Canvas: a plain card with a Reload button (no styles file needed, nothing that can throw). */
export function ReloadCard() {
  return (
    <div
      role="alert"
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
        background: '#0b1118',
        color: '#e8eef5',
        font: '16px system-ui, sans-serif',
      }}
    >
      <div style={{ fontSize: 20 }}>Something went wrong with the 3D view.</div>
      <button
        type="button"
        onClick={() => window.location.reload()}
        style={{ padding: '10px 22px', borderRadius: 8, border: 0, background: '#3b82f6', color: '#fff', font: 'inherit', cursor: 'pointer' }}
      >
        Reload
      </button>
    </div>
  )
}

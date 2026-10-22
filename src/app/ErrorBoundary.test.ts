import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ErrorBoundary, ReloadCard } from './ErrorBoundary'

function Bomb(): never {
  throw new Error('boom')
}
const ok = () => createElement('p', null, 'fine')

describe('ErrorBoundary (F-01)', () => {
  it('renders its children while nothing throws', () => {
    expect(renderToString(createElement(ErrorBoundary, { name: 't' }, createElement(ok)))).toContain('fine')
  })

  it('turns a render error into its state, and the state into the fallback', () => {
    const state = ErrorBoundary.getDerivedStateFromError(new Error('boom'))
    expect(state.failed).toBe(true)
    const b = new ErrorBoundary({ name: 't', fallback: createElement('i', null, 'fallback'), children: createElement(Bomb) })
    b.state = state
    // the fallback replaces the child that throws: rendering the boundary's output never reaches Bomb
    expect(renderToString(b.render() as never)).toContain('fallback')
  })

  it('shows nothing by default after a throw, and the Reload card for the canvas', () => {
    const b = new ErrorBoundary({ name: 't', children: createElement(Bomb) })
    b.state = ErrorBoundary.getDerivedStateFromError(new Error('boom'))
    expect(b.render()).toBeNull()
    expect(renderToString(createElement(ReloadCard))).toContain('Reload')
  })
})

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import { ErrorBoundary, ReloadCard } from './app/ErrorBoundary'
import './styles/base.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* F-01: the last net, for anything that throws outside the boundaries inside App */}
    <ErrorBoundary name="root" fallback={<ReloadCard />}>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)

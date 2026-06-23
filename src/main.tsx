import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import './index.css'
import App from './App.tsx'
import { installBackendAuth } from './lib/backend-auth'

// Attach the shared-secret token (if configured) to backend requests before any
// fetch fires. No-op when no token is set.
installBackendAuth()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

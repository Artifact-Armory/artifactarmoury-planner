import React from 'react'
import ReactDOM from 'react-dom/client'
// Before the app renders, so a crash during the very first render is still
// reported. No-op when VITE_SENTRY_DSN is unset.
import { initSentry } from './lib/sentry'
import App from './app'
import './index.css'

initSentry()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)


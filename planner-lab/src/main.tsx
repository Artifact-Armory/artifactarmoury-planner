import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import App from '@ui/App'
import ThemeSwitcher from './ThemeSwitcher'
import './index.css'

// Minimal harness: mounts the planner directly, no site chrome/routing
// around it. Always opens in "scratch" mode (no tableId/shareToken) — see
// README.md if you want to load/edit a specific saved table by id.
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Toaster position="top-center" />
      <ThemeSwitcher />
      <App />
    </BrowserRouter>
  </React.StrictMode>,
)

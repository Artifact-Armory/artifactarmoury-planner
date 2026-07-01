import React from 'react'
import PlannerApp from '@ui/App'

// Full-screen table planner — intentionally renders outside MainLayout
// so the 3D canvas fills the entire viewport.
export default function Planner() {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 10 }}>
      <PlannerApp />
    </div>
  )
}

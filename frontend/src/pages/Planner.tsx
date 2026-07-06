import React from 'react'
import { useParams } from 'react-router-dom'
import PlannerApp from '@ui/App'

// Full-screen table planner — intentionally renders outside MainLayout
// so the 3D canvas fills the entire viewport.
//   /planner            → scratch (save creates a new table)
//   /planner/t/:id      → edit one of your saved tables
//   /planner/s/:token   → open a shared table as an editable copy
//   /planner/view/:id   → open a published table read-only (marketplace)
export default function Planner({ readOnly = false }: { readOnly?: boolean }) {
  const { id, token } = useParams<{ id?: string; token?: string }>()
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 10 }}>
      <PlannerApp tableId={id} shareToken={token} readOnly={readOnly} />
    </div>
  )
}

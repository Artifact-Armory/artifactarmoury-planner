import React, { Suspense, lazy } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useIsDesktop } from '../hooks/useIsDesktop'

// The 3D Table Planner (Three.js, InstancedMesh-based) is desktop-only by
// design — grid-snap placement and camera controls assume mouse + trackpad
// input. Named constant (not a magic number): matches the site's own `lg`
// Tailwind breakpoint, and is the narrowest width the planner's toolbars/
// palette were laid out for. Adjust here if that changes.
const PLANNER_MIN_WIDTH = 1024

// Lazy so the Three.js/planner chunk is only ever requested once the desktop
// check below has passed — mobile visitors never fetch it.
const PlannerApp = lazy(() => import('@ui/App'))

// Full-screen table planner — intentionally renders outside MainLayout
// so the 3D canvas fills the entire viewport.
//   /planner            → scratch (save creates a new table)
//   /planner/t/:id      → edit one of your saved tables
//   /planner/s/:token   → open a shared table as an editable copy
//   /planner/view/:id   → open a published table read-only (marketplace)
export default function Planner({ readOnly = false }: { readOnly?: boolean }) {
  const { id, token } = useParams<{ id?: string; token?: string }>()
  const isDesktop = useIsDesktop(PLANNER_MIN_WIDTH)

  // Haven't run the client-side check yet — render nothing rather than guess,
  // so neither the planner nor the fallback flashes before we know.
  if (isDesktop === null) return null

  if (!isDesktop) {
    return (
      <div style={{ position: 'fixed', inset: 0, zIndex: 10 }}>
        <PlannerUnavailable />
      </div>
    )
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 10 }}>
      <Suspense fallback={<PlannerLoading />}>
        <PlannerApp tableId={id} shareToken={token} readOnly={readOnly} />
      </Suspense>
    </div>
  )
}

function PlannerUnavailable() {
  return (
    <div className="h-full w-full flex flex-col items-center justify-center px-6 text-center bg-background">
      <h2 className="text-2xl font-semibold mb-2">The Table Planner needs a bigger screen</h2>
      <p className="text-muted-foreground max-w-md mb-6">
        It's built for desktop — grid placement and camera controls need a mouse and a bit of
        room. Open this page on a laptop or desktop to design your table.
      </p>
      <Link
        to="/browse"
        className="inline-flex items-center rounded-lg bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:bg-primary/80"
      >
        Browse terrain instead →
      </Link>
    </div>
  )
}

function PlannerLoading() {
  return (
    <div className="h-full w-full flex items-center justify-center bg-background text-muted-foreground text-sm">
      Loading planner…
    </div>
  )
}

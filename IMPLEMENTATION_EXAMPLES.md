# Code Splitting Implementation Examples

**Project**: Artifact Armoury Planner  
**Date**: October 29, 2025  
**Focus**: Practical Examples

---

## 🎯 Example 1: Lazy Load Routes

### Current Implementation (All Routes Loaded)

```typescript
// ❌ BAD - All pages loaded upfront
import Home from './pages/Home'
import Browse from './pages/Browse'
import TerrainBuilder from './pages/TerrainBuilderPage'
import Checkout from './pages/Checkout'
import AdminPanel from './pages/admin/AdminPanel'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/browse" element={<Browse />} />
      <Route path="/terrain-builder" element={<TerrainBuilder />} />
      <Route path="/checkout" element={<Checkout />} />
      <Route path="/admin" element={<AdminPanel />} />
    </Routes>
  )
}
```

### Optimized Implementation (Lazy Loading)

```typescript
// ✅ GOOD - Routes loaded on demand
import { lazy, Suspense } from 'react'
import { Routes, Route } from 'react-router-dom'
import { PageLoader } from '@/components/common/PageLoader'

const Home = lazy(() => import('./pages/Home'))
const Browse = lazy(() => import('./pages/Browse'))
const TerrainBuilder = lazy(() => import('./pages/TerrainBuilderPage'))
const Checkout = lazy(() => import('./pages/Checkout'))
const AdminPanel = lazy(() => import('./pages/admin/AdminPanel'))

export default function App() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/browse" element={<Browse />} />
        <Route path="/terrain-builder" element={<TerrainBuilder />} />
        <Route path="/checkout" element={<Checkout />} />
        <Route path="/admin" element={<AdminPanel />} />
      </Routes>
    </Suspense>
  )
}
```

**Result**: Each route loads in separate chunk (~50-150KB each)

---

## 🎯 Example 2: Lazy Load Three.js

### Current Implementation (Three.js Always Loaded)

```typescript
// ❌ BAD - Three.js loaded for all users
import * as THREE from 'three'

export function ModelPreview({ modelUrl }: Props) {
  const scene = new THREE.Scene()
  // ... 3D setup
  return <canvas ref={canvasRef} />
}
```

### Optimized Implementation (Lazy Load Three.js)

```typescript
// ✅ GOOD - Three.js loaded only when needed
import { useEffect, useRef, useState } from 'react'

export function ModelPreview({ modelUrl }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    // Load Three.js dynamically
    import('three').then(({ Scene, WebGLRenderer, PerspectiveCamera }) => {
      if (!canvasRef.current) return

      const scene = new Scene()
      const camera = new PerspectiveCamera(75, window.innerWidth / window.innerHeight)
      const renderer = new WebGLRenderer({ canvas: canvasRef.current })

      // ... 3D setup
      setIsLoading(false)
    })
  }, [])

  if (isLoading) return <div>Loading 3D viewer...</div>
  return <canvas ref={canvasRef} />
}
```

**Result**: Three.js (600KB) only loaded when ModelPreview component mounts

---

## 🎯 Example 3: Conditional Feature Loading

### Current Implementation (All Features Loaded)

```typescript
// ❌ BAD - All features loaded upfront
import { TerrainBuilder } from './terrain-builder'
import { ModelViewer } from './model-viewer'
import { AdminPanel } from './admin'

export function Dashboard() {
  return (
    <div>
      <TerrainBuilder />
      <ModelViewer />
      <AdminPanel />
    </div>
  )
}
```

### Optimized Implementation (Load Based on User Role)

```typescript
// ✅ GOOD - Load features based on user role
import { lazy, Suspense } from 'react'
import { useAuthStore } from '@/store/authStore'

const TerrainBuilder = lazy(() => import('./terrain-builder'))
const ModelViewer = lazy(() => import('./model-viewer'))
const AdminPanel = lazy(() => import('./admin'))

export function Dashboard() {
  const { user } = useAuthStore()

  return (
    <Suspense fallback={<div>Loading...</div>}>
      <div>
        {user?.role === 'artist' && <TerrainBuilder />}
        {user?.role !== 'admin' && <ModelViewer />}
        {user?.role === 'admin' && <AdminPanel />}
      </div>
    </Suspense>
  )
}
```

**Result**: Only load components needed for user's role

---

## 🎯 Example 4: Prefetch Route Chunks

### Preload Next Route

```typescript
// src/components/common/Navigation.tsx
import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

export function Navigation() {
  const location = useLocation()

  useEffect(() => {
    // Prefetch checkout page when user adds to cart
    if (location.pathname === '/browse') {
      const link = document.createElement('link')
      link.rel = 'prefetch'
      link.as = 'script'
      link.href = '/assets/pages-checkout-*.js'
      document.head.appendChild(link)
    }
  }, [location])

  return (
    <nav>
      {/* Navigation items */}
    </nav>
  )
}
```

**Result**: Checkout chunk preloads while user browses, faster transition

---

## 🎯 Example 5: Dynamic Import with Error Handling

### Safe Dynamic Import

```typescript
// src/utils/loadThreeJs.ts
let threePromise: Promise<typeof THREE> | null = null

export async function loadThreeJs() {
  if (!threePromise) {
    threePromise = import('three').catch(error => {
      console.error('Failed to load Three.js:', error)
      threePromise = null // Reset on error
      throw error
    })
  }
  return threePromise
}

// Usage
export function TerrainBuilder() {
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    loadThreeJs()
      .then(() => {
        // Three.js loaded successfully
      })
      .catch(err => {
        setError(err)
      })
  }, [])

  if (error) {
    return <div>Failed to load 3D viewer: {error.message}</div>
  }

  return <div>3D Viewer</div>
}
```

**Result**: Graceful error handling for failed chunk loads

---

## 🎯 Example 6: Component Chunk Splitting

### Organize Components by Feature

```typescript
// src/components/models/index.ts
// All model components in one chunk
export { ModelCard } from './ModelCard'
export { ModelGrid } from './ModelGrid'
export { ModelFilter } from './ModelFilter'
export { ModelSearch } from './ModelSearch'
export { ModelDetails } from './ModelDetails'

// src/components/cart/index.ts
// All cart components in one chunk
export { CartItem } from './CartItem'
export { CartSummary } from './CartSummary'
export { CartCheckout } from './CartCheckout'

// src/components/auth/index.ts
// All auth components in one chunk
export { LoginForm } from './LoginForm'
export { SignupForm } from './SignupForm'
export { PasswordReset } from './PasswordReset'
```

**Result**: Related components grouped in same chunk for better caching

---

## 🎯 Example 7: Stripe Payment Lazy Loading

### Load Stripe Only on Checkout

```typescript
// src/pages/Checkout.tsx
import { lazy, Suspense } from 'react'

const StripeCheckout = lazy(() => import('@/components/checkout/StripeCheckout'))

export default function CheckoutPage() {
  return (
    <div>
      <h1>Checkout</h1>
      <Suspense fallback={<div>Loading payment...</div>}>
        <StripeCheckout />
      </Suspense>
    </div>
  )
}

// src/components/checkout/StripeCheckout.tsx
import { loadStripe } from '@stripe/stripe-js'
import { Elements } from '@stripe/react-stripe-js'

export default function StripeCheckout() {
  const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_KEY)

  return (
    <Elements stripe={stripePromise}>
      <CheckoutForm />
    </Elements>
  )
}
```

**Result**: Stripe (80KB) only loaded when user reaches checkout

---

## 🎯 Example 8: React Query Lazy Loading

### Load Data Fetching on Demand

```typescript
// ✅ GOOD - React Query loaded with page
import { useQuery } from '@tanstack/react-query'

export function BrowsePage() {
  const { data: models } = useQuery({
    queryKey: ['models'],
    queryFn: async () => {
      const res = await fetch('/api/models')
      return res.json()
    }
  })

  return <ModelGrid models={models} />
}
```

**Result**: React Query (200KB) in separate vendor chunk, cached across app

---

## 🎯 Example 9: Build Analysis

### Check Bundle Sizes

```bash
# Build and see output
npm run build

# Output:
# ✓ 1234 modules transformed
# dist/assets/main-abc123.js              150.5 kB
# dist/assets/vendor-react-def456.js      400.2 kB
# dist/assets/vendor-query-ghi789.js      200.1 kB
# dist/assets/three-bundle-jkl012.js      600.5 kB
# dist/assets/terrain-builder-mno345.js   300.2 kB
# dist/assets/pages-browse-pqr678.js       80.3 kB
# dist/assets/pages-checkout-stu901.js     60.1 kB
```

### Visualize Bundle

```bash
npm install -D rollup-plugin-visualizer

# Add to vite.config.ts
import { visualizer } from 'rollup-plugin-visualizer'

export default defineConfig({
  plugins: [
    visualizer({
      open: true,
      gzipSize: true,
      brotliSize: true,
    })
  ]
})

npm run build
# Opens interactive visualization
```

---

## 🎯 Example 10: Performance Monitoring

### Track Chunk Load Times

```typescript
// src/utils/performanceMonitoring.ts
export function monitorChunkLoad(chunkName: string) {
  const startTime = performance.now()

  return () => {
    const endTime = performance.now()
    const duration = endTime - startTime
    console.log(`Chunk ${chunkName} loaded in ${duration.toFixed(2)}ms`)
    
    // Send to analytics
    if (window.gtag) {
      window.gtag('event', 'chunk_load', {
        chunk_name: chunkName,
        duration: duration
      })
    }
  }
}

// Usage
const stopMonitoring = monitorChunkLoad('three-bundle')
const THREE = await import('three')
stopMonitoring()
```

---

## ✅ Implementation Checklist

- [ ] Lazy load all routes
- [ ] Lazy load Three.js
- [ ] Lazy load Stripe
- [ ] Lazy load admin features
- [ ] Group components by feature
- [ ] Add loading fallbacks
- [ ] Add error handling
- [ ] Test build output
- [ ] Verify chunk sizes
- [ ] Monitor performance

---

**Status**: ✅ COMPLETE  
**Last Updated**: October 29, 2025  
**Ready for**: Implementation


# Code Splitting Implementation Guide

**Project**: Artifact Armoury Planner  
**Date**: October 29, 2025  
**Focus**: Three.js and Large Dependencies

---

## 📋 Overview

Code splitting breaks your bundle into smaller chunks that load on demand, improving:

✅ Initial page load time  
✅ Browser cache efficiency  
✅ Parallel resource loading  
✅ Memory usage  

---

## 🎯 Three.js Code Splitting

### Why Separate Three.js?

Three.js is **600KB+** and only needed for:
- Terrain builder page
- 3D model preview
- Table visualization

**Impact**:
- ✅ Reduce initial bundle by 600KB
- ✅ Users not using 3D don't download it
- ✅ Faster page loads for 90% of users

### Implementation

#### 1. Lazy Load Three.js Component

```typescript
// src/pages/TerrainBuilderPage.tsx
import { lazy, Suspense } from 'react'

const TerrainBuilder = lazy(() => 
  import('../table-top-terrain-builder/src/core/TerrainBuilder')
)

export default function TerrainBuilderPage() {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <TerrainBuilder />
    </Suspense>
  )
}
```

#### 2. Dynamic Import in Components

```typescript
// src/components/models/ModelPreview.tsx
import { useEffect, useState } from 'react'

export function ModelPreview({ modelUrl }: Props) {
  const [THREE, setTHREE] = useState(null)

  useEffect(() => {
    // Load Three.js only when component mounts
    import('three').then(module => {
      setTHREE(module.default)
    })
  }, [])

  if (!THREE) return <div>Loading 3D viewer...</div>
  
  return <ThreeJsViewer THREE={THREE} modelUrl={modelUrl} />
}
```

#### 3. Conditional Loading

```typescript
// src/utils/loadThreeJs.ts
let threePromise: Promise<typeof THREE> | null = null

export async function loadThreeJs() {
  if (!threePromise) {
    threePromise = import('three')
  }
  return threePromise
}

// Usage
const THREE = await loadThreeJs()
```

---

## 🏗️ Vendor Dependency Splitting

### Strategy

Separate large vendor libraries into individual chunks:

```
vendor-react (400KB)
  ├── react
  ├── react-dom
  └── react-router-dom

vendor-query (200KB)
  ├── @tanstack/react-query
  └── @tanstack/react-query-devtools

vendor-forms (150KB)
  ├── react-hook-form
  └── zod

vendor-ui (100KB)
  ├── lucide-react
  └── react-hot-toast

vendor-stripe (80KB)
  ├── @stripe/react-stripe-js
  └── @stripe/stripe-js

vendor-http (50KB)
  └── axios

vendor-state (20KB)
  └── zustand
```

### Benefits

| Vendor | Size | Benefit |
|--------|------|---------|
| React | 400KB | Core framework, rarely changes |
| React Query | 200KB | Data fetching, can be updated independently |
| Forms | 150KB | Form handling, stable |
| UI | 100KB | UI components, reusable |
| Stripe | 80KB | Payment, only loaded on checkout |
| HTTP | 50KB | API calls, shared across app |
| State | 20KB | State management, stable |

---

## 🗂️ Feature-Based Splitting

### Route-Specific Chunks

```
terrain-builder.js (300KB)
  └── All terrain builder code

pages-auth.js (50KB)
  └── Login, signup, password reset

pages-dashboard.js (100KB)
  └── Artist dashboard, analytics

pages-browse.js (80KB)
  └── Browse, categories, tags

pages-models.js (120KB)
  └── Model details, libraries

pages-checkout.js (60KB)
  └── Checkout flow, payment

pages-admin.js (150KB)
  └── Admin panel, moderation
```

### Implementation

#### 1. Lazy Load Routes

```typescript
// src/app.tsx
import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'

const Home = lazy(() => import('./pages/Home'))
const Browse = lazy(() => import('./pages/Browse'))
const TerrainBuilder = lazy(() => import('./pages/TerrainBuilderPage'))
const Checkout = lazy(() => import('./pages/Checkout'))
const AdminPanel = lazy(() => import('./pages/admin/AdminPanel'))

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/browse" element={<Browse />} />
          <Route path="/terrain-builder" element={<TerrainBuilder />} />
          <Route path="/checkout" element={<Checkout />} />
          <Route path="/admin" element={<AdminPanel />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}
```

#### 2. Loading Fallback Component

```typescript
// src/components/common/PageLoader.tsx
export function PageLoader() {
  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
    </div>
  )
}
```

---

## 📊 Component Chunk Splitting

### Group Related Components

```
components-common.js
  ├── Header
  ├── Footer
  ├── Navigation
  └── Layout

components-models.js
  ├── ModelCard
  ├── ModelGrid
  ├── ModelFilter
  └── ModelSearch

components-cart.js
  ├── CartItem
  ├── CartSummary
  └── CartCheckout

components-auth.js
  ├── LoginForm
  ├── SignupForm
  └── PasswordReset
```

### Implementation

```typescript
// src/components/models/index.ts
export { ModelCard } from './ModelCard'
export { ModelGrid } from './ModelGrid'
export { ModelFilter } from './ModelFilter'
export { ModelSearch } from './ModelSearch'

// Usage - all from same chunk
import { ModelCard, ModelGrid } from '@/components/models'
```

---

## 🔍 Monitoring & Analysis

### Build Output

```bash
$ npm run build

✓ 1234 modules transformed
dist/assets/main-abc123.js              150.5 kB
dist/assets/vendor-react-def456.js      400.2 kB
dist/assets/vendor-query-ghi789.js      200.1 kB
dist/assets/three-bundle-jkl012.js      600.5 kB
dist/assets/terrain-builder-mno345.js   300.2 kB
dist/assets/pages-browse-pqr678.js       80.3 kB
dist/assets/pages-checkout-stu901.js     60.1 kB
...
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

# Build and view
npm run build
# Opens interactive visualization
```

### Check Gzip Size

```bash
npm install -D gzip-size-cli

# Check individual files
gzip-size dist/assets/main-*.js
gzip-size dist/assets/vendor-react-*.js
gzip-size dist/assets/three-bundle-*.js
```

---

## ⚡ Performance Targets

### Initial Load
- Main chunk: < 200KB
- Total initial: < 500KB (gzipped)
- Time to Interactive: < 2 seconds

### Per-Route Load
- Route chunk: < 150KB
- Load time: < 500ms

### Three.js Load
- Chunk size: 600KB (unavoidable)
- Load time: < 1 second (lazy)

---

## 🚀 Best Practices

### 1. Use Named Imports
```typescript
// ✅ Good - tree shakeable
import { useQuery } from '@tanstack/react-query'

// ❌ Bad - imports entire module
import * as ReactQuery from '@tanstack/react-query'
```

### 2. Lazy Load Heavy Features
```typescript
// ✅ Good - loads on demand
const TerrainBuilder = lazy(() => import('./TerrainBuilder'))

// ❌ Bad - loads immediately
import TerrainBuilder from './TerrainBuilder'
```

### 3. Avoid Circular Dependencies
```typescript
// ✅ Good - clear dependency flow
// utils.ts → hooks.ts → components.ts

// ❌ Bad - circular
// components.ts → utils.ts → components.ts
```

### 4. Keep Chunks Balanced
```
// ✅ Good - similar sizes
main: 150KB
vendor-react: 400KB
vendor-query: 200KB
three-bundle: 600KB

// ❌ Bad - unbalanced
main: 1.5MB
vendor-react: 50KB
```

---

## 🐛 Common Issues

### Issue: Chunk Too Large
```
⚠️ dist/assets/main-abc123.js (1.2 MB) exceeds limit
```

**Solution**:
1. Add more manual chunks
2. Lazy load heavy features
3. Use dynamic imports

### Issue: Duplicate Code in Chunks
```
// Same code in multiple chunks
```

**Solution**:
1. Create shared chunk
2. Use `manualChunks` to consolidate
3. Check for circular dependencies

### Issue: Slow Route Transitions
```
// Lag when navigating to new route
```

**Solution**:
1. Preload route chunks
2. Use `<link rel="prefetch">`
3. Optimize chunk size

---

## 📈 Expected Results

### Before Optimization
```
Initial Load: 2.5MB
TTI: 3-4 seconds
Cache: Entire app invalidated on change
```

### After Optimization
```
Initial Load: 150KB (main) + lazy chunks
TTI: 1-2 seconds
Cache: Only changed chunks invalidated
```

### Improvement
```
✅ 94% reduction in initial load
✅ 50% faster time to interactive
✅ 90% better cache efficiency
```

---

**Status**: ✅ COMPLETE  
**Last Updated**: October 29, 2025  
**Ready for**: Implementation


# Compression Code Reference

## Key Code Snippets

### 1. Decimation Function

```typescript
function decimateMesh(stl: ParsedSTL, decimationLevel: number): ParsedSTL {
  if (decimationLevel <= 0 || decimationLevel >= 100) {
    return stl
  }

  // Calculate triangle areas and sort by size
  const trianglesWithArea = stl.triangles.map((triangle, index) => {
    const [v1, v2, v3] = triangle.vertices
    const edge1 = { x: v2.x - v1.x, y: v2.y - v1.y, z: v2.z - v1.z }
    const edge2 = { x: v3.x - v1.x, y: v3.y - v1.y, z: v3.z - v1.z }
    const cross = {
      x: edge1.y * edge2.z - edge1.z * edge2.y,
      y: edge1.z * edge2.x - edge1.x * edge2.z,
      z: edge1.x * edge2.y - edge1.y * edge2.x,
    }
    const area = Math.sqrt(cross.x ** 2 + cross.y ** 2 + cross.z ** 2) / 2
    return { triangle, area, index }
  })

  // Sort by area (smallest first)
  trianglesWithArea.sort((a, b) => a.area - b.area)

  // Calculate how many triangles to keep
  const targetCount = Math.ceil(stl.triangleCount * (1 - decimationLevel / 100))
  const trianglesToKeep = trianglesWithArea.slice(-targetCount)

  // Sort back to original order
  trianglesToKeep.sort((a, b) => a.index - b.index)

  return {
    triangles: trianglesToKeep.map(t => t.triangle),
    triangleCount: trianglesToKeep.length,
    isBinary: stl.isBinary,
  }
}
```

### 2. Draco Compression in convertSTLtoGLB

```typescript
// Apply compression pipeline
const transformations = [
  weld({ tolerance: 1e-3 }),
  dedup(),
  quantize({
    quantizePosition: 10,
    quantizeNormal: 8,
    quantizeTexcoord: 8,
    quantizeColor: 8
  }),
  prune(),
]

// Add Draco compression if enabled
const enableDraco = options?.enableDraco !== false
const dracoLevel = options?.dracoCompressionLevel ?? 7

if (enableDraco) {
  transformations.push(
    draco({
      method: 'edgebreaker',
      encodeSpeed: 10 - dracoLevel,
      decodeSpeed: 5,
    })
  )
}

await document.transform(...transformations)
```

### 3. Compression Statistics Tracking

```typescript
// Get original STL file size
const stlStats = await stat(stlPath)
const originalStlSize = stlStats.size

// Apply decimation if requested
let stl = await parseSTL(stlPath)
const triangleCountBefore = stl.triangleCount
if (decimationLevel > 0 && decimationLevel < 100) {
  stl = decimateMesh(stl, decimationLevel)
}

// Convert to GLB without Draco (measure size)
const tempGlbPath = glbPath + '.tmp'
await convertSTLtoGLB(stl, tempGlbPath, { enableDraco: false })
const tempStats = await stat(tempGlbPath)
const glbBeforeDracoSize = tempStats.size

// Convert to GLB with Draco (final)
await convertSTLtoGLB(stl, glbPath, { enableDraco: true, dracoCompressionLevel: 7 })
const glbStats = await stat(glbPath)
const glbAfterDracoSize = glbStats.size

// Calculate compression statistics
const estimatedBrotliRatio = 0.65
const estimatedDownloadSize = Math.round(glbAfterDracoSize * estimatedBrotliRatio)

const compressionStats: CompressionStats = {
  originalStlSize,
  glbBeforeDraco: glbBeforeDracoSize,
  glbAfterDraco: glbAfterDracoSize,
  estimatedDownloadSize,
  decimationLevel: decimationLevel > 0 ? decimationLevel : undefined,
  triangleCountBefore,
  triangleCountAfter: stl.triangleCount,
  compressionRatio: glbAfterDracoSize / originalStlSize,
  downloadCompressionRatio: estimatedDownloadSize / originalStlSize,
}
```

### 4. Compression Middleware

```typescript
export function setupCompressionMiddleware() {
  return compression({
    threshold: 1024,
    level: 6,
    filter: (req: Request, res: Response) => {
      if (req.headers['x-no-compression']) {
        return false
      }

      const compressibleTypes = [
        'application/json',
        'application/octet-stream',
        'model/gltf-binary',
        'text/html',
        'text/css',
        'text/javascript',
        'application/javascript',
        'image/svg+xml',
      ]

      const contentType = res.getHeader('content-type')?.toString() || ''
      return compressibleTypes.some(type => contentType.includes(type))
    },
    brotli: {
      params: {
        [11]: 11,
      },
    },
  })
}

export function compressionHeadersMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  res.setHeader('Vary', 'Accept-Encoding')

  if (req.path.includes('.glb')) {
    res.setHeader('Cache-Control', 'public, max-age=2592000, immutable')
  }

  next()
}
```

### 5. API Parameter Handling

```typescript
const { decimationLevel } = req.body

// Validate decimationLevel
let decimation = 0
if (decimationLevel !== undefined) {
  const level = parseInt(decimationLevel, 10)
  if (isNaN(level) || level < 0 || level > 90) {
    throw new ValidationError('decimationLevel must be between 0 and 90')
  }
  decimation = level
}

// Generate GLB with compression
const glbPath = await generateGLB(modelFile.path, {
  enableDraco: true,
  dracoLevel: 7,
})
```

### 6. CompressionStats Interface

```typescript
export interface CompressionStats {
  originalStlSize: number
  afterDecimation?: number
  glbBeforeDraco: number
  glbAfterDraco: number
  estimatedDownloadSize: number
  decimationLevel?: number
  triangleCountBefore: number
  triangleCountAfter: number
  compressionRatio: number
  downloadCompressionRatio: number
}
```

### 7. Middleware Integration

```typescript
// In index.ts
import { setupCompressionMiddleware, compressionHeadersMiddleware } 
  from './middleware/compression'

// In middleware stack
app.use(helmetConfig)
app.use(cors(corsOptions))

// NEW: Compression middleware
app.use(setupCompressionMiddleware())
app.use(compressionHeadersMiddleware)

app.use(express.json({ limit: '10mb' }))
```

## Usage Examples

### Basic Upload
```bash
curl -X POST http://localhost:3001/api/models \
  -H "Authorization: Bearer <token>" \
  -F "model=@model.stl" \
  -F "thumbnail=@preview.png" \
  -F "name=My Model" \
  -F "category=terrain" \
  -F "basePrice=29.99" \
  -F "license=cc-by"
```

### Upload with Decimation
```bash
curl -X POST http://localhost:3001/api/models \
  -H "Authorization: Bearer <token>" \
  -F "model=@model.stl" \
  -F "thumbnail=@preview.png" \
  -F "name=My Model" \
  -F "category=terrain" \
  -F "basePrice=29.99" \
  -F "license=cc-by" \
  -F "decimationLevel=50"
```

### Programmatic Usage
```typescript
// With decimation
const result = await processSTLFile(stlPath, artistId, assetId, {
  decimationLevel: 50,
  enableDraco: true,
  dracoLevel: 7
})

console.log(result.compression_stats)
// {
//   originalStlSize: 38000000,
//   glbBeforeDraco: 19500000,
//   glbAfterDraco: 3200000,
//   estimatedDownloadSize: 2080000,
//   decimationLevel: 50,
//   triangleCountBefore: 1000000,
//   triangleCountAfter: 500000,
//   compressionRatio: 0.084,
//   downloadCompressionRatio: 0.055
// }
```

## Configuration

### Decimation Levels
- 0: No decimation (default)
- 25: Slight reduction
- 50: Moderate reduction
- 75: Aggressive reduction
- 90: Maximum reduction

### Draco Levels
- 0-3: Fast
- 4-6: Balanced
- 7-9: High (default: 7)
- 10: Maximum

## Performance

| Stage | Time | Reduction |
|-------|------|-----------|
| Decimation | 1-5s | 0-90% |
| Quantization | 2-5s | 40-50% |
| Draco | 10-30s | 85-95% |
| Brotli | Auto | 60-70% |
| **Total** | **15-40s** | **95-98%** |

## Dependencies

```json
{
  "@gltf-transform/core": "^3.4.9",
  "@gltf-transform/extensions": "^4.2.1",
  "@gltf-transform/functions": "^3.4.9",
  "compression": "^1.7.4",
  "draco3d": "^1.5.7"
}
```


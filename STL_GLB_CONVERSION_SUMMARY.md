# STL Upload Processing & GLB Conversion Summary

## Overview
When a user uploads an STL file, the backend processes it through a complete pipeline that includes parsing, analysis, GLB conversion with compression, and thumbnail generation.

## File Processing Pipeline

### 1. **STL Parsing** (`parseSTL()`)
- **Input**: STL file (ASCII or binary format)
- **Process**:
  - Detects format by checking header (binary vs ASCII)
  - Parses all triangles with vertices and normals
  - Supports both ASCII and binary STL formats
- **Output**: `ParsedSTL` object with triangle data and count

### 2. **Geometry Analysis**
Three calculations are performed on the parsed STL:

#### a) **Bounding Box (AABB)** - `calculateAABB()`
- Finds min/max X, Y, Z coordinates across all vertices
- Used to determine model dimensions

#### b) **Footprint** - `calculateFootprint()`
- Calculates width, depth, height from AABB
- Stored in database for spatial planning

#### c) **Print Statistics** - `calculatePrintStats()`
- **Volume**: Calculated using divergence theorem (mm³)
- **Weight**: Estimated using PLA density (1.24 g/cm³)
- **Print Time**: Rough estimate (1g ≈ 2 minutes)
- **Surface Area**: Calculated from triangle areas
- **Triangle Count**: Total mesh complexity

### 3. **STL to GLB Conversion** (`convertSTLtoGLB()`)

#### Conversion Steps:
1. **Create glTF Document**: Initialize empty glTF document with buffer
2. **Build Geometry**:
   - Create position array (Float32Array) from STL vertices
   - Create normal array from triangle normals
   - Create index array (Uint16Array or Uint32Array depending on vertex count)
   - **Coordinate System Swap**: Convert from Blender Z-up to glTF Y-up
     - X stays X
     - Y becomes Z
     - Z becomes Y

3. **Create Material**: Default gray material (0.82, 0.82, 0.82)
   - Metallic: 0
   - Roughness: 0.85

4. **Compression Pipeline** (lines 393-403):
   ```
   weld({ tolerance: 1e-3 })      → Merge vertices within 0.001 units
   dedup()                          → Remove duplicate data
   quantize({
     quantizePosition: 10,          → 10-bit position precision
     quantizeNormal: 8,             → 8-bit normal precision
     quantizeTexcoord: 8,
     quantizeColor: 8
   })
   prune()                          → Remove unused data
   ```

5. **Write Binary**: Export as GLB binary format

#### Compression Details:
- **Weld (tolerance 1e-3)**: Aggressively merges nearby vertices to reduce mesh complexity
- **Quantization**: Reduces precision of vertex data:
  - 10-bit positions: ~0.1% precision loss
  - 8-bit normals: Sufficient for lighting calculations
- **Dedup**: Removes duplicate vertex/index data
- **Prune**: Removes unused buffers and attributes

#### File Size Reduction:
- Typical reduction: **40-50%** of original STL size
- Example: 38MB STL → ~19-22MB GLB
- Compression is lossy but visually imperceptible for tabletop terrain

### 4. **Thumbnail Generation** (`generateThumbnailFromSTL()`)
- **Method**: Top-down orthographic projection with depth shading
- **Size**: 512×512 PNG
- **Process**:
  - Projects all triangles onto XY plane
  - Uses Z-buffer for depth ordering
  - Renders grayscale based on height (darker = lower)
  - Background: Dark blue (#121E1E)
- **Purpose**: Library preview image

### 5. **Complete Processing Pipeline** (`processSTLFile()`)
Orchestrates all steps:
1. Parse STL
2. Calculate AABB, footprint, print stats
3. Convert to GLB (with error handling - continues if fails)
4. Generate thumbnail
5. Return file paths and metadata

## File Storage Structure
```
uploads/
├── models/
│   └── {artistId}/
│       └── {assetId}/
│           ├── {assetId}.stl          (original, uncompressed)
│           └── {assetId}.glb          (compressed, ~40-50% smaller)
└── thumbnails/
    └── {artistId}/
        └── {assetId}/
            └── {assetId}_thumb.png    (512×512 preview)
```

## Key Design Decisions

1. **Keep Original STL**: Stored uncompressed for archival/re-processing
2. **GLB for Display**: Used in 3D viewer (compressed, faster loading)
3. **Aggressive Compression**: Prioritizes file size over precision (acceptable for terrain)
4. **Error Handling**: GLB conversion failure doesn't block upload (STL fallback)
5. **Coordinate System**: Converts Blender Z-up to glTF Y-up standard
6. **Metadata Calculation**: All stats computed server-side for accuracy

## Performance Characteristics

- **Parsing**: O(n) where n = triangle count
- **Conversion**: O(n) with compression overhead
- **Typical Times**:
  - Small model (10k triangles): ~100-200ms
  - Large model (100k triangles): ~1-2s
  - Compression: ~30-50% of conversion time

## Fallback Behavior

If GLB conversion fails:
- Upload still succeeds
- STL remains available
- Frontend can load STL directly (slower, larger)
- Error logged but not blocking


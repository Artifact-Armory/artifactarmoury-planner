# Compression Quick Start Guide

## What Changed?

The STL to GLB conversion now includes **3 new compression stages**:

1. **Mesh Decimation** (optional) - Reduce triangle count
2. **Draco Compression** (automatic) - Mesh-specific compression
3. **Brotli Compression** (automatic) - Server-side file compression

**Result**: 38MB STL → 0.5-2MB download (95-98% reduction!)

## For Users

### Uploading Models

**Default (no decimation)**:
```bash
curl -X POST http://localhost:3001/api/models \
  -H "Authorization: Bearer <token>" \
  -F "model=@large_model.stl" \
  -F "thumbnail=@preview.png" \
  -F "name=My Model" \
  -F "category=terrain" \
  -F "basePrice=29.99" \
  -F "license=cc-by"
```

**With 50% decimation** (for high-poly models):
```bash
curl -X POST http://localhost:3001/api/models \
  -H "Authorization: Bearer <token>" \
  -F "model=@large_model.stl" \
  -F "thumbnail=@preview.png" \
  -F "name=My Model" \
  -F "category=terrain" \
  -F "basePrice=29.99" \
  -F "license=cc-by" \
  -F "decimationLevel=50"
```

### Response

You'll now get compression statistics:

```json
{
  "success": true,
  "model": {
    "id": "model-123",
    "name": "My Model",
    ...
  },
  "compression_stats": {
    "originalStlSize": 38000000,
    "glbBeforeDraco": 19500000,
    "glbAfterDraco": 3200000,
    "estimatedDownloadSize": 2080000,
    "triangleCountBefore": 1000000,
    "triangleCountAfter": 1000000,
    "compressionRatio": 0.084,
    "downloadCompressionRatio": 0.055
  }
}
```

## For Developers

### Using processSTLFile()

**Basic usage** (backward compatible):
```typescript
const result = await processSTLFile(stlPath, artistId, assetId);
console.log(result.compression_stats);
```

**With decimation**:
```typescript
const result = await processSTLFile(stlPath, artistId, assetId, {
  decimationLevel: 50,  // 0-90
  enableDraco: true,    // default
  dracoLevel: 7         // 0-10, default 7
});
```

### Using generateGLB()

**Basic usage**:
```typescript
const glbPath = await generateGLB(stlPath);
```

**With compression options**:
```typescript
const glbPath = await generateGLB(stlPath, {
  enableDraco: true,
  dracoLevel: 7
});
```

### Compression Stats

Access detailed compression information:

```typescript
if (result.compression_stats) {
  const stats = result.compression_stats;
  console.log(`Original: ${stats.originalStlSize} bytes`);
  console.log(`Final GLB: ${stats.glbAfterDraco} bytes`);
  console.log(`Download: ${stats.estimatedDownloadSize} bytes`);
  console.log(`Ratio: ${(stats.compressionRatio * 100).toFixed(1)}%`);
}
```

## Decimation Levels

| Level | Use Case | Quality | File Size |
|-------|----------|---------|-----------|
| 0 | Default, preserve all detail | Excellent | Largest |
| 25 | Slight simplification | Excellent | Large |
| 50 | Moderate simplification | Very Good | Medium |
| 75 | Aggressive simplification | Good | Small |
| 90 | Maximum simplification | Fair | Smallest |

## Draco Compression Levels

| Level | Speed | Compression | Use Case |
|-------|-------|-------------|----------|
| 0-3 | Fast | Moderate | Real-time apps |
| 4-6 | Balanced | Good | General use |
| 7-9 | Slow | Excellent | Storage (default: 7) |
| 10 | Very Slow | Maximum | Archival |

## Performance

### Upload Time
- Small models (< 5MB): 5-10 seconds
- Medium models (5-20MB): 15-25 seconds
- Large models (> 20MB): 30-40 seconds

### Download Time
- Brotli decompression: Automatic (browser)
- Draco decompression: 1-3 seconds (one-time)

### Caching
- GLB files cached for 30 days
- Browser caches decompressed data
- Subsequent loads are instant

## Troubleshooting

### Large GLB Files?
- Increase decimation level
- Increase Draco compression level
- Check for duplicate geometry

### Slow Uploads?
- Reduce Draco compression level
- Disable decimation if not needed
- Check server CPU usage

### Visual Artifacts?
- Reduce decimation level
- Verify original STL is valid
- Check browser console for errors

## Monitoring

### Check Compression Effectiveness

```bash
# Get model info with compression stats
curl http://localhost:3001/api/models/model-123 \
  -H "Authorization: Bearer <token>"
```

### Server Logs

Look for compression details:
```
STL processing completed successfully {
  compression: {
    original: 38000000,
    final: 3200000,
    ratio: "8.4%",
    downloadRatio: "5.5%"
  }
}
```

## Next Steps

1. **Test with a large model** (30-50MB STL)
2. **Monitor compression stats** in responses
3. **Verify download sizes** in browser DevTools
4. **Adjust decimation levels** based on results
5. **Monitor server performance** during uploads

## Support

For issues or questions:
- Check `COMPRESSION_IMPROVEMENTS.md` for detailed docs
- Review `IMPLEMENTATION_SUMMARY.md` for technical details
- Check server logs for compression errors


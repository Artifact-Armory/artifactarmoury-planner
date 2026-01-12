# Artifact Armoury - Architecture & Flow Diagrams

---

## 1. System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         CLIENT LAYER                            │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  React 18 + Vite                                         │   │
│  │  ├─ Pages: Browse, Dashboard, Artist, Admin, Table      │   │
│  │  ├─ Components: ModelCard, Cart, 3D Viewer              │   │
│  │  ├─ State: Zustand (app, auth, library, UI)             │   │
│  │  └─ 3D: Three.js (WebGL rendering)                      │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                    ↕ REST API (Axios)
┌─────────────────────────────────────────────────────────────────┐
│                      API LAYER                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Express.js + TypeScript                                │   │
│  │  ├─ Routes: /auth, /models, /browse, /orders, /tables   │   │
│  │  ├─ Middleware: Auth, Upload, Compression, Security     │   │
│  │  └─ Services: File Processing, Watermarking, Payments   │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                    ↕ SQL Queries
┌─────────────────────────────────────────────────────────────────┐
│                    DATA LAYER                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  PostgreSQL 14+                                          │   │
│  │  ├─ users, models, orders, tables, reviews              │   │
│  │  ├─ order_items, payments, favorites, assets            │   │
│  │  └─ activity_log, invite_codes                          │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                    ↕ File I/O
┌─────────────────────────────────────────────────────────────────┐
│                  STORAGE LAYER                                  │
│  ├─ Local Disk: /uploads/models, /uploads/temp                 │
│  ├─ Files: STL (original), GLB (compressed), Thumbnails        │
│  └─ Future: S3 bucket integration                              │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. File Processing Pipeline

```
┌─────────────────────────────────────────────────────────────┐
│ UPLOAD STL FILE (38MB)                                      │
└─────────────────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────────────┐
│ PARSE STL                                                   │
│ ├─ Detect format (Binary/ASCII)                             │
│ ├─ Read 80-byte header                                      │
│ ├─ Extract triangle count                                   │
│ └─ Parse 50 bytes per triangle                              │
│ Result: 780,854 triangles                                   │
└─────────────────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────────────┐
│ WATERMARK                                                   │
│ ├─ Embed artist ID in header                                │
│ ├─ Create fingerprint signature                             │
│ └─ Detect duplicates                                        │
└─────────────────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────────────┐
│ CALCULATE GEOMETRY                                          │
│ ├─ AABB (Axis-Aligned Bounding Box)                         │
│ ├─ Footprint (grid-based occupancy)                         │
│ ├─ Volume & Surface Area                                    │
│ └─ Support requirements                                     │
└─────────────────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────────────┐
│ OPTIONAL: DECIMATION (0-90%)                                │
│ └─ Reduce triangle count for performance                    │
└─────────────────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────────────┐
│ CONVERT TO GLB (4-STAGE COMPRESSION)                        │
│                                                             │
│ Stage 1: WELD (Vertex Merging)                              │
│ └─ Tolerance: 0.1mm (0.0001m)                               │
│ └─ Reduction: ~5%                                           │
│                                                             │
│ Stage 2: QUANTIZE (Precision Reduction)                     │
│ ├─ Position: 12-bit (±2048 range)                           │
│ ├─ Normal: 8-bit                                            │
│ └─ Reduction: ~20%                                          │
│                                                             │
│ Stage 3: DRACO (Mesh Compression)                           │
│ ├─ Method: Edgebreaker                                      │
│ ├─ Level: 7 (high compression)                              │
│ └─ Reduction: ~60%                                          │
│                                                             │
│ Stage 4: BROTLI (Server Compression)                        │
│ ├─ Quality: 11 (maximum)                                    │
│ └─ Reduction: ~70%                                          │
│                                                             │
│ TOTAL: 38MB → 19MB (50% reduction)                          │
└─────────────────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────────────┐
│ GENERATE THUMBNAIL                                          │
│ ├─ Grayscale heightmap from model                           │
│ ├─ 512x512 PNG                                              │
│ └─ ~50KB                                                    │
└─────────────────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────────────┐
│ STORE FILES                                                 │
│ ├─ Original STL: /uploads/models/{artistId}/{assetId}.stl   │
│ ├─ GLB Preview: /uploads/models/{artistId}/{assetId}.glb    │
│ └─ Thumbnail: /uploads/thumbnails/{assetId}.png            │
└─────────────────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────────────┐
│ DATABASE ENTRY                                              │
│ ├─ Model metadata (name, description, price)                │
│ ├─ File paths (STL, GLB, thumbnail)                         │
│ ├─ Geometry (width, depth, height)                          │
│ └─ Status (draft, published)                                │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. 3D Table Builder Flow

```
┌──────────────────────────────────────────────────────────┐
│ USER OPENS TABLE BUILDER                                 │
└──────────────────────────────────────────────────────────┘
                    ↓
┌──────────────────────────────────────────────────────────┐
│ INITIALIZE THREE.JS SCENE                                │
│ ├─ WebGL Renderer (antialiased)                           │
│ ├─ Perspective Camera (50° FOV)                           │
│ ├─ Orbit Controls (damped)                                │
│ ├─ Lighting (ambient + directional)                       │
│ └─ Table Plane (1.8288m × 1.2192m)                        │
└──────────────────────────────────────────────────────────┘
                    ↓
┌──────────────────────────────────────────────────────────┐
│ LOAD ASSETS                                              │
│ ├─ Fetch published models from API                        │
│ ├─ Load GLB files (compressed)                            │
│ ├─ Measure AABB for each model                            │
│ └─ Create proxy boxes during loading                      │
└──────────────────────────────────────────────────────────┘
                    ↓
┌──────────────────────────────────────────────────────────┐
│ USER SELECTS MODEL TO PLACE                              │
└──────────────────────────────────────────────────────────┘
                    ↓
┌──────────────────────────────────────────────────────────┐
│ SHOW PLACEMENT GHOST                                     │
│ ├─ Follow mouse cursor                                    │
│ ├─ Show grid-snapped position                             │
│ ├─ Display rotation (0°, 90°, 180°, 270°)                │
│ └─ Color: Green (valid) or Red (invalid)                  │
└──────────────────────────────────────────────────────────┘
                    ↓
┌──────────────────────────────────────────────────────────┐
│ VALIDATE PLACEMENT                                       │
│ ├─ Convert world position to grid cell                    │
│ ├─ Calculate footprint cells                              │
│ ├─ Check table bounds                                     │
│ ├─ Check collision with existing models                   │
│ └─ Update ghost color (green/red)                         │
└──────────────────────────────────────────────────────────┘
                    ↓
┌──────────────────────────────────────────────────────────┐
│ USER CLICKS TO PLACE                                     │
└──────────────────────────────────────────────────────────┘
                    ↓
┌──────────────────────────────────────────────────────────┐
│ ADD INSTANCE TO SCENE                                    │
│ ├─ Create Instance object                                 │
│ ├─ Load actual GLB model                                  │
│ ├─ Apply position & rotation                              │
│ ├─ Add to occupancy map                                   │
│ └─ Update Zustand store                                   │
└──────────────────────────────────────────────────────────┘
                    ↓
┌──────────────────────────────────────────────────────────┐
│ USER CAN MANIPULATE                                      │
│ ├─ Drag to move (grid-snapped)                            │
│ ├─ Rotate with mouse drag                                 │
│ ├─ Scale with scroll                                      │
│ ├─ Delete with key press                                  │
│ └─ Undo/Redo with history                                 │
└──────────────────────────────────────────────────────────┘
                    ↓
┌──────────────────────────────────────────────────────────┐
│ SAVE LAYOUT                                              │
│ ├─ Serialize instances to JSON                            │
│ ├─ Store in database                                      │
│ ├─ Generate unique share link                             │
│ └─ Allow export as image                                  │
└──────────────────────────────────────────────────────────┘
```

---

## 4. Purchase & Download Flow

```
┌──────────────────────────────────────────────────────────┐
│ CUSTOMER BROWSES MODELS                                  │
└──────────────────────────────────────────────────────────┘
                    ↓
┌──────────────────────────────────────────────────────────┐
│ ADD TO CART                                              │
│ └─ Store in Zustand basket                                │
└──────────────────────────────────────────────────────────┘
                    ↓
┌──────────────────────────────────────────────────────────┐
│ PROCEED TO CHECKOUT                                      │
│ ├─ Display cart items                                     │
│ ├─ Calculate total (model price + commission)             │
│ └─ Show artist commission breakdown                       │
└──────────────────────────────────────────────────────────┘
                    ↓
┌──────────────────────────────────────────────────────────┐
│ STRIPE PAYMENT                                           │
│ ├─ Create Stripe session                                  │
│ ├─ Redirect to Stripe checkout                            │
│ ├─ Process payment                                        │
│ └─ Webhook confirmation                                   │
└──────────────────────────────────────────────────────────┘
                    ↓
┌──────────────────────────────────────────────────────────┐
│ CREATE ORDER                                             │
│ ├─ Insert order record (payment_status = 'succeeded')     │
│ ├─ Create order_items for each model                      │
│ ├─ Calculate artist commission                            │
│ └─ Send confirmation email                                │
└──────────────────────────────────────────────────────────┘
                    ↓
┌──────────────────────────────────────────────────────────┐
│ CUSTOMER DOWNLOADS                                       │
│ ├─ Click download button                                  │
│ ├─ Verify JWT token                                       │
│ ├─ Check purchase (order with payment_status='succeeded') │
│ ├─ Serve original STL file (38MB)                         │
│ ├─ Increment download_count                               │
│ └─ Log download event                                     │
└──────────────────────────────────────────────────────────┘
                    ↓
┌──────────────────────────────────────────────────────────┐
│ CUSTOMER USES STL                                        │
│ ├─ Open in 3D slicer (Cura, PrusaSlicer, etc.)            │
│ ├─ Prepare for 3D printing                                │
│ └─ Print on FDM/SLA/SLS printer                           │
└──────────────────────────────────────────────────────────┘
```

---

## 5. Collision Detection Algorithm

```
┌─────────────────────────────────────────────────────────┐
│ PLACEMENT VALIDATION                                    │
└─────────────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────────┐
│ 1. CONVERT WORLD POSITION TO GRID CELL                  │
│    cell = Math.round(worldPos / gridSize)               │
│    Example: 1.5m / 0.3048m = cell 5                     │
└─────────────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────────┐
│ 2. GET FOOTPRINT CELLS                                  │
│    ├─ Get model AABB (width, depth)                     │
│    ├─ Apply rotation (0°, 90°, 180°, 270°)              │
│    ├─ Calculate cells occupied                          │
│    └─ Example: 2×3 grid cells                           │
└─────────────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────────┐
│ 3. CHECK TABLE BOUNDS                                   │
│    ├─ Min cell: (0, 0)                                  │
│    ├─ Max cell: (table_width/grid, table_height/grid)   │
│    └─ Reject if out of bounds                           │
└─────────────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────────┐
│ 4. CHECK COLLISION WITH EXISTING MODELS                 │
│    ├─ Build occupancy map from all instances            │
│    ├─ Check if any footprint cell is occupied           │
│    └─ Reject if collision detected                      │
└─────────────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────────┐
│ RESULT                                                  │
│ ├─ Valid: Green ghost, allow placement                  │
│ └─ Invalid: Red ghost, prevent placement                │
└─────────────────────────────────────────────────────────┘
```

---

## 6. Authentication Flow

```
┌──────────────────────────────────────────────────────────┐
│ USER REGISTRATION                                        │
└──────────────────────────────────────────────────────────┘
                    ↓
┌──────────────────────────────────────────────────────────┐
│ VALIDATE INPUT                                           │
│ ├─ Email format                                           │
│ ├─ Password strength                                      │
│ └─ Display name                                           │
└──────────────────────────────────────────────────────────┘
                    ↓
┌──────────────────────────────────────────────────────────┐
│ HASH PASSWORD (bcrypt, 10 rounds)                        │
│ └─ $2b$10$...                                             │
└──────────────────────────────────────────────────────────┘
                    ↓
┌──────────────────────────────────────────────────────────┐
│ STORE IN DATABASE                                        │
│ ├─ users table                                            │
│ ├─ role = 'customer' (default)                            │
│ └─ created_at = now()                                     │
└──────────────────────────────────────────────────────────┘
                    ↓
┌──────────────────────────────────────────────────────────┐
│ USER LOGIN                                               │
└──────────────────────────────────────────────────────────┘
                    ↓
┌──────────────────────────────────────────────────────────┐
│ VERIFY CREDENTIALS                                       │
│ ├─ Find user by email                                     │
│ ├─ Compare password with bcrypt                           │
│ └─ Reject if mismatch                                     │
└──────────────────────────────────────────────────────────┘
                    ↓
┌──────────────────────────────────────────────────────────┐
│ GENERATE JWT TOKENS                                      │
│ ├─ Access token (7 days expiry)                           │
│ │  Payload: userId, email, role                          │
│ ├─ Refresh token (30 days expiry)                         │
│ │  Payload: userId                                       │
│ └─ Sign with JWT_SECRET                                  │
└──────────────────────────────────────────────────────────┘
                    ↓
┌──────────────────────────────────────────────────────────┐
│ RETURN TOKENS TO CLIENT                                  │
│ └─ Store in localStorage                                 │
└──────────────────────────────────────────────────────────┘
                    ↓
┌──────────────────────────────────────────────────────────┐
│ PROTECTED REQUESTS                                       │
│ ├─ Include Authorization: Bearer {token}                 │
│ ├─ Backend verifies JWT signature                        │
│ ├─ Extract userId from payload                           │
│ └─ Allow/deny based on permissions                       │
└──────────────────────────────────────────────────────────┘
```

---

## 7. Data Model Relationships

```
users (1) ──────────< (∞) models
  │                        │
  │                        ├─ (1) ──────────< (∞) model_images
  │                        ├─ (1) ──────────< (∞) reviews
  │                        └─ (1) ──────────< (∞) order_items
  │
  ├─ (1) ──────────< (∞) orders
  │                        └─ (1) ──────────< (∞) order_items
  │
  ├─ (1) ──────────< (∞) tables
  │
  ├─ (1) ──────────< (∞) favorites
  │
  └─ (1) ──────────< (∞) payments
```

---

**Diagrams Created**: 7 comprehensive flow diagrams  
**Coverage**: Architecture, file processing, UI flow, collision detection, auth, purchase, data model


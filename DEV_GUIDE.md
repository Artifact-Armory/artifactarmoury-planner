# Artifact Builder - Development Guide

## Project Overview

**Artifact Builder** is a 3D terrain marketplace for tabletop gaming. Users browse models, plan layouts on a virtual 3D table, and purchase STL files for printing. Artists upload models and earn commissions via Stripe Connect.

---

## Tech Stack

### Backend
- **Runtime**: Node.js 18+ with TypeScript
- **Framework**: Express.js
- **Database**: PostgreSQL 14+
- **Authentication**: JWT with bcrypt
- **Payments**: Stripe + Stripe Connect
- **File Storage**: Local disk (S3-ready)
- **File Processing**: STL parsing, GLB conversion, Three.js
- **Security**: Helmet, CORS, rate limiting

### Frontend
- **Framework**: React 18 + TypeScript
- **Build Tool**: Vite
- **Routing**: React Router v6
- **State**: Zustand
- **Styling**: Tailwind CSS
- **3D Rendering**: Three.js
- **HTTP Client**: Axios
- **Forms**: React Hook Form
- **Notifications**: react-hot-toast

---

## Project Structure

```
artifact-builder/
├── backend/
│   ├── src/
│   │   ├── index.ts              # Server entry point
│   │   ├── app.ts                # Express app configuration
│   │   ├── config/
│   │   │   └── env.ts            # Environment variables
│   │   ├── db/
│   │   │   ├── index.ts          # PostgreSQL pool
│   │   │   └── schema.sql        # Database schema
│   │   ├── middleware/
│   │   │   ├── auth.ts           # JWT authentication
│   │   │   ├── security.ts       # Rate limiting, CORS
│   │   │   ├── upload.ts         # Multer file uploads
│   │   │   └── error.ts          # Error handling
│   │   ├── routes/
│   │   │   ├── auth.ts           # /api/auth
│   │   │   ├── models.ts         # /api/models
│   │   │   ├── browse.ts         # /api/browse
│   │   │   ├── artists.ts        # /api/artists
│   │   │   ├── tables.ts         # /api/tables
│   │   │   ├── orders.ts         # /api/orders
│   │   │   └── admin.ts          # /api/admin
│   │   ├── services/
│   │   │   ├── stripe.ts         # Payment integration
│   │   │   ├── email.ts          # Resend/SendGrid
│   │   │   ├── storage.ts        # File management
│   │   │   ├── fileProcessor.ts  # STL/GLB processing
│   │   │   └── printEstimator.ts # Print calculations
│   │   ├── utils/
│   │   │   ├── logger.ts         # Logging
│   │   │   └── validation.ts     # Input validation
│   │   └── types/
│   │       └── express.d.ts      # TypeScript augmentation
│   ├── scripts/
│   │   └── seed-dev-data.ts      # Database seeding
│   ├── package.json
│   ├── tsconfig.json
│   └── .env.example
│
└── frontend/
    ├── src/
    │   ├── main.tsx              # React entry
    │   ├── App.tsx               # Routes & providers
    │   ├── api/
    │   │   ├── client.ts         # Axios instance
    │   │   └── endpoints/
    │   │       ├── auth.ts
    │   │       ├── models.ts
    │   │       ├── browse.ts
    │   │       ├── artists.ts
    │   │       ├── tables.ts
    │   │       ├── orders.ts
    │   │       └── admin.ts
    │   ├── store/
    │   │   ├── authStore.ts      # Zustand auth
    │   │   └── cartStore.ts      # Shopping cart
    │   ├── components/
    │   │   ├── auth/
    │   │   │   └── ProtectedRoute.tsx
    │   │   ├── layout/
    │   │   │   ├── Header.tsx
    │   │   │   ├── Footer.tsx
    │   │   │   ├── MainLayout.tsx
    │   │   │   └── DashboardLayout.tsx
    │   │   ├── models/
    │   │   │   ├── ModelCard.tsx
    │   │   │   └── ModelGrid.tsx
    │   │   └── ui/
    │   │       ├── Button.tsx
    │   │       ├── Input.tsx
    │   │       └── Spinner.tsx
    │   ├── pages/
    │   │   ├── Home.tsx
    │   │   ├── Browse.tsx
    │   │   ├── ModelDetails.tsx
    │   │   ├── auth/
    │   │   │   ├── Login.tsx
    │   │   │   └── Register.tsx
    │   │   ├── dashboard/
    │   │   │   ├── Dashboard.tsx
    │   │   │   ├── PurchaseHistory.tsx
    │   │   │   ├── Wishlist.tsx
    │   │   │   └── MyTables.tsx
    │   │   ├── artist/
    │   │   │   ├── ArtistDashboard.tsx
    │   │   │   ├── ArtistModels.tsx
    │   │   │   ├── CreateModel.tsx
    │   │   │   └── ArtistSales.tsx
    │   │   └── admin/
    │   │       ├── AdminDashboard.tsx
    │   │       ├── AdminUsers.tsx
    │   │       └── AdminModels.tsx
    │   └── utils/
    │       └── format.ts
    ├── package.json
    ├── tsconfig.json
    ├── vite.config.ts
    └── .env.example
```

---

## Database Schema

### Core Tables

1. **users** - Customer/artist/admin accounts
2. **models** - 3D terrain assets
3. **model_images** - Additional model photos
4. **tables** - Saved table layouts (JSON)
5. **orders** - Purchase records
6. **order_items** - Items in orders with artist commissions
7. **payments** - Artist payout tracking
8. **invite_codes** - Artist registration codes
9. **reviews** - Model ratings/reviews
10. **favorites** - User wishlists
11. **activity_log** - Audit trail

### Key Relationships

```sql
users (1) ──< (∞) models
users (1) ──< (∞) orders
users (1) ──< (∞) tables
models (1) ──< (∞) order_items
orders (1) ──< (∞) order_items
models (1) ──< (∞) model_images
models (1) ──< (∞) reviews
models (1) ──< (∞) favorites
```

---

## Coding Standards

### TypeScript

```typescript
// Always use explicit types
interface User {
  id: string;
  email: string;
  role: 'customer' | 'artist' | 'admin';
}

// Use async/await, not callbacks
async function getUser(id: string): Promise<User> {
  const result = await db.query('SELECT * FROM users WHERE id = $1', [id]);
  return result.rows[0];
}

// Use named exports for utilities
export function formatPrice(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

// Default export for components/routes
export default UserProfile;
```

### Error Handling

```typescript
// Backend: Use custom error classes
throw new ValidationError('Email is required');
throw new NotFoundError('Model');
throw new AuthenticationError('Invalid token');

// Frontend: Use try-catch with user feedback
try {
  await authApi.login(credentials);
  toast.success('Logged in successfully');
} catch (error) {
  toast.error(error.response?.data?.message || 'Login failed');
}
```

### Database Queries

```typescript
// Always use parameterized queries
const result = await db.query(
  'SELECT * FROM models WHERE artist_id = $1 AND status = $2',
  [artistId, 'published']
);

// Use transactions for multi-step operations
const client = await db.connect();
try {
  await client.query('BEGIN');
  // ... multiple queries
  await client.query('COMMIT');
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
}
```

### API Routes

```typescript
// Structure: Verb + Path + Middleware + Handler
router.post('/models',
  authenticate,           // JWT verification
  requireArtist,          // Role check
  uploadRateLimit,        // Rate limiting
  uploadModelFiles,       // File upload
  validateModelData,      // Input validation
  asyncHandler(async (req, res) => {
    // Route logic
    res.status(201).json({ success: true, data: model });
  })
);
```

### React Components

```typescript
// Functional components with TypeScript
interface ModelCardProps {
  model: Model;
  onAddToCart?: (model: Model) => void;
}

const ModelCard: React.FC<ModelCardProps> = ({ model, onAddToCart }) => {
  // Component logic
  return (
    <div className="bg-white rounded-lg shadow-md">
      {/* Component JSX */}
    </div>
  );
};

export default ModelCard;
```

### State Management (Zustand)

```typescript
interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  login: (token: string, user: User) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: localStorage.getItem('token'),
  isAuthenticated: false,
  login: (token, user) => {
    localStorage.setItem('token', token);
    set({ token, user, isAuthenticated: true });
  },
  logout: () => {
    localStorage.removeItem('token');
    set({ token: null, user: null, isAuthenticated: false });
  }
}));
```

---

## API Conventions

### Request Format

```typescript
// POST/PUT bodies
{
  "name": "Medieval Tower",
  "description": "Epic terrain piece",
  "category": "buildings",
  "basePrice": 12.99
}

// Query parameters for lists
GET /api/browse?page=1&limit=20&category=buildings&sort=popular
```

### Response Format

```typescript
// Success (200-299)
{
  "success": true,
  "data": { /* resource */ },
  "message": "Optional success message"
}

// Error (400-599)
{
  "success": false,
  "error": "ValidationError",
  "message": "Email is required",
  "details": { /* optional */ }
}

// List responses
{
  "success": true,
  "data": [ /* items */ ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "totalItems": 150,
    "totalPages": 8
  }
}
```

### Status Codes

- **200** - Success (GET, PUT)
- **201** - Created (POST)
- **204** - No Content (DELETE)
- **400** - Bad Request (validation errors)
- **401** - Unauthorized (no/invalid token)
- **403** - Forbidden (insufficient permissions)
- **404** - Not Found
- **409** - Conflict (duplicate resource)
- **429** - Too Many Requests (rate limit)
- **500** - Internal Server Error

---

## Authentication Flow

### Registration
1. POST `/api/auth/register` with email, password, displayName
2. Hash password with bcrypt (12 rounds)
3. Create user with role='customer'
4. Return JWT token + user object
5. (Optional) Send verification email

### Login
1. POST `/api/auth/login` with email, password
2. Verify password with bcrypt.compare()
3. Check account_status (active/suspended/banned)
4. Generate JWT token (7-day expiry)
5. Return token + user object

### Protected Routes
1. Frontend includes `Authorization: Bearer <token>` header
2. Backend `authenticate` middleware verifies JWT
3. Decode userId from token
4. Fetch user from database
5. Attach `req.user` for route access

### Role Checks
```typescript
// Require specific role
router.get('/artist/sales', authenticate, requireArtist, handler);

// Multiple roles allowed
const requireArtist = requireRole('artist', 'admin');

// Optional authentication
router.get('/models/:id', optionalAuth, handler);
```

---

## File Upload System

### Configuration

```typescript
// Max file sizes
STL_MAX_SIZE = 100MB
IMAGE_MAX_SIZE = 10MB

// Allowed types
ALLOWED_STL = ['.stl', '.glb']
ALLOWED_IMAGES = ['.jpg', '.jpeg', '.png', '.webp']

// Storage structure
/uploads/
  /models/{artistId}/{assetId}/
    - model.stl
    - model.glb
    - thumbnail.png
  /images/{artistId}/{assetId}/
    - image-1.jpg
    - image-2.jpg
  /thumbnails/{artistId}/{assetId}/
    - thumb.png
```

### Processing Pipeline

1. **Upload** - Multer receives file
2. **Validate** - Check size, type, virus scan
3. **Parse STL** - Read binary/ASCII format
4. **Calculate Geometry** - AABB, volume, footprint
5. **Convert to GLB** - Three.js export
6. **Generate Thumbnail** - Render preview image
7. **Save Metadata** - Store in database
8. **Cleanup** - Remove temp files

---

## Stripe Integration

### Payment Flow

1. User adds items to cart
2. POST `/api/orders` creates order with status='pending'
3. Backend creates Stripe PaymentIntent
4. Returns `clientSecret` to frontend
5. Frontend shows Stripe Elements
6. User completes payment
7. Stripe webhook calls `/api/webhooks/stripe`
8. Backend updates order status to 'paid'
9. Artist commissions calculated automatically

### Artist Payouts

1. Artist completes Stripe Connect onboarding
2. Store `stripe_account_id` in users table
3. On order completion, create Transfer to artist
4. Commission = `order_item.artist_commission_amount`
5. Track in `payments` table with status

---

## Environment Variables

### Backend (.env)

```bash
# Server
NODE_ENV=development
PORT=3001

# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/artifact_builder

# Auth
JWT_SECRET=your-secret-key-minimum-32-characters
JWT_EXPIRES_IN=7d

# Stripe
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_CONNECT_CLIENT_ID=ca_...

# Email
RESEND_API_KEY=re_...
EMAIL_FROM=noreply@artifactbuilder.com

# Storage
UPLOAD_DIR=./uploads
MAX_FILE_SIZE=104857600

# URLs
FRONTEND_URL=http://localhost:3000
BASE_URL=http://localhost:3001
```

### Frontend (.env)

```bash
VITE_API_BASE_URL=http://localhost:3001
VITE_STRIPE_PUBLISHABLE_KEY=pk_test_...
```

---

## Development Workflow

### Setup

```bash
# Backend
cd backend
npm install
cp .env.example .env
# Edit .env with your credentials
npm run migrate  # Run database schema
npm run seed     # Seed dev data
npm run dev      # Start dev server (port 3001)

# Frontend
cd frontend
npm install
cp .env.example .env
npm run dev      # Start Vite (port 3000)
```

### Database Commands

```bash
# Initialize schema
npm run migrate

# Seed development data
npm run seed

# Generate invite code
npm run generate-invite
```

### Default Credentials (dev)

```
Email: admin@artifactbuilder.com
Password: password123

Artist: artist1@example.com / password123
Customer: customer1@example.com / password123

Invite Codes: ARTIST2024, BETA2024, WELCOME
```

---

## Testing Standards

### Backend Tests

```typescript
// Integration tests with supertest
describe('POST /api/auth/register', () => {
  it('should register a new user', async () => {
    const response = await request(app)
      .post('/api/auth/register')
      .send({
        email: 'test@example.com',
        password: 'SecurePass123!',
        displayName: 'Test User'
      });
    
    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.data.token).toBeDefined();
  });
});
```

### Frontend Tests

```typescript
// Component tests with React Testing Library
import { render, screen, fireEvent } from '@testing-library/react';
import ModelCard from './ModelCard';

test('displays model information', () => {
  const model = { name: 'Tower', price: 12.99 };
  render(<ModelCard model={model} />);
  
  expect(screen.getByText('Tower')).toBeInTheDocument();
  expect(screen.getByText('$12.99')).toBeInTheDocument();
});
```

---

## Current Development Status

### ✅ Completed

- Database schema with migrations
- Full authentication system (JWT + bcrypt)
- Role-based access control
- File upload and STL processing
- API routing structure (all endpoints scaffolded)
- Frontend page scaffolding (all routes created)
- Stripe payment foundation
- Protected route system
- State management (Zustand)
- Error handling middleware

### ⚠️ In Progress / Needs Implementation

1. **3D Viewer** - Three.js component for model preview
2. **Table Builder** - Interactive 3D placement system
3. **Checkout Flow** - Complete Stripe payment UI
4. **Email Service** - Configure Resend/SendGrid
5. **Search/Filter** - Browse page filtering implementation
6. **Image Gallery** - Multi-image upload for models
7. **Admin Moderation** - Flag/approve model UI
8. **Analytics Dashboards** - Artist sales charts
9. **Print Farm Integration** - CraftCloud API implementation
10. **Order Fulfillment** - Tracking and status updates

---

## Priority Feature Roadmap

### Phase 1 - Core Marketplace (MVP)
- [ ] 3D model viewer (Three.js)
- [ ] Browse page with filtering
- [ ] Model detail page with purchase
- [ ] Complete Stripe checkout flow
- [ ] Email notifications (order confirmations)
- [ ] Basic artist dashboard

### Phase 2 - Table Builder
- [ ] Interactive 3D table builder
- [ ] Drag-and-drop model placement
- [ ] Rotation and scaling controls
- [ ] Save/load/share layouts
- [ ] Export to PDF/image

### Phase 3 - Community Features
- [ ] Artist profiles and portfolios
- [ ] Model reviews and ratings
- [ ] Social sharing
- [ ] Favorites/wishlist system
- [ ] Follow artists

### Phase 4 - Advanced Features
- [ ] Print farm integration
- [ ] Advanced print cost calculator
- [ ] Bulk operations for admins
- [ ] Analytics and reporting
- [ ] Multi-currency support

---

## Common Tasks

### Add a New API Endpoint

```typescript
// 1. Define route in routes/
router.get('/models/:id',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const model = await getModelById(id);
    
    if (!model) {
      throw new NotFoundError('Model');
    }
    
    res.json({ success: true, data: model });
  })
);

// 2. Add to frontend API client
export const modelsApi = {
  getById: async (id: string): Promise<Model> => {
    const response = await apiClient.get(`/api/models/${id}`);
    return response.data.data;
  }
};

// 3. Use in component
const { data: model, isLoading } = useQuery(
  ['model', id],
  () => modelsApi.getById(id)
);
```

### Add a New Page

```typescript
// 1. Create component
// src/pages/NewPage.tsx
const NewPage: React.FC = () => {
  return <div>New Page</div>;
};
export default NewPage;

// 2. Add route in App.tsx
<Route path="/new-page" element={<NewPage />} />

// 3. Add navigation link
<Link to="/new-page">New Page</Link>
```

### Add Database Migration

```sql
-- Create migration file: migrations/002_add_column.sql
ALTER TABLE models ADD COLUMN featured BOOLEAN DEFAULT false;
CREATE INDEX idx_models_featured ON models(featured) WHERE featured = true;

-- Run migration
npm run migrate
```

---

## Troubleshooting

### "Database connection failed"
- Check DATABASE_URL in .env
- Ensure PostgreSQL is running: `psql -l`
- Test connection: `npm run migrate`

### "JWT authentication failed"
- Verify JWT_SECRET is set in .env
- Check token in localStorage (Frontend DevTools)
- Token may be expired (7-day default)

### "File upload failed"
- Check UPLOAD_DIR exists and is writable
- Verify file size under MAX_FILE_SIZE
- Check Multer configuration in middleware/upload.ts

### "Stripe payment failed"
- Verify STRIPE_SECRET_KEY is correct
- Check webhook secret matches Stripe dashboard
- Test with Stripe test cards: 4242 4242 4242 4242

---

## Git Workflow

```bash
# Feature branches
git checkout -b feature/table-builder

# Commit conventions
git commit -m "feat: add 3D table builder component"
git commit -m "fix: resolve model upload validation"
git commit -m "docs: update API documentation"

# Types: feat, fix, docs, style, refactor, test, chore
```

---

## Resources

- **Three.js Docs**: https://threejs.org/docs/
- **Stripe API**: https://stripe.com/docs/api
- **PostgreSQL Docs**: https://www.postgresql.org/docs/
- **React Router**: https://reactrouter.com/
- **Zustand**: https://github.com/pmndrs/zustand
- **Tailwind CSS**: https://tailwindcss.com/docs

---

## Support & Contact

For questions or issues during development, refer to:
- Backend API: Check `src/routes/` for endpoint definitions
- Database: See `db/schema.sql` for table structures
- Frontend: Review `src/components/` for reusable UI
- State: Check `src/store/` for Zustand stores

---

**Last Updated**: January 2025
**Version**: 1.0.0
**License**: MIT

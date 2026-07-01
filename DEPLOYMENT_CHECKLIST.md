# Deployment Checklist - Artifact Armoury Planner

**Target**: Railway  
**Status**: Ready to Deploy  
**Date**: October 29, 2025

---

## ✅ Pre-Deployment Checklist

### Code Preparation
- [ ] All code committed to GitHub
- [ ] No uncommitted changes
- [ ] `.env` files are in `.gitignore`
- [ ] `Dockerfile` is in root directory
- [ ] `docker-compose.yml` is in root directory
- [ ] `railway.json` is in root directory

### Environment Setup
- [ ] Generate JWT_SECRET: `openssl rand -base64 32`
- [ ] Prepare `.env.production.example` values
- [ ] Have your domain name ready (or use Railway subdomain)
- [ ] Stripe keys ready (or use STRIPE_MOCK=true)

### Local Testing (Optional but Recommended)
- [ ] Build Docker image: `docker build -t artifact-armoury .`
- [ ] Run docker-compose: `docker-compose up`
- [ ] Test health endpoint: `curl http://localhost:3001/health`
- [ ] Test API: `curl http://localhost:3001/api`
- [ ] Run migrations: `npm run migrate`

---

## 🚀 Deployment Steps

### Step 1: Create Railway Account
- [ ] Go to https://railway.app
- [ ] Sign up with GitHub
- [ ] Authorize Railway to access your repositories

### Step 2: Create New Project
- [ ] Click "New Project" in Railway dashboard
- [ ] Select "Deploy from GitHub"
- [ ] Select `artifactarmoury-planner` repository
- [ ] Click "Deploy"

### Step 3: Add PostgreSQL Database
- [ ] In Railway project, click "Add Service"
- [ ] Select "PostgreSQL"
- [ ] Wait for database to initialize
- [ ] Copy `DATABASE_URL` from PostgreSQL service

### Step 4: Configure Environment Variables
In your app service, add these variables:

```
NODE_ENV=production
PORT=3001
JWT_SECRET=<your-generated-secret>
UPLOAD_DIR=/app/uploads
FRONTEND_URL=https://<your-railway-domain>.railway.app
BASE_URL=https://<your-railway-domain>.railway.app
EMAIL_FROM=noreply@artifactarmoury.com
STRIPE_MOCK=true
RESEND_API_KEY=
DB_POOL_MIN=5
DB_POOL_MAX=20
```

- [ ] All variables added
- [ ] JWT_SECRET is strong (32+ characters)
- [ ] URLs match your domain

### Step 5: Deploy
- [ ] Push code to GitHub main branch
- [ ] Railway automatically deploys
- [ ] Wait for build to complete (2-3 minutes)
- [ ] Check logs for errors

### Step 6: Run Migrations
- [ ] Go to app service in Railway
- [ ] Click "Terminal" tab
- [ ] Run: `npm run migrate`
- [ ] Verify schema is created

### Step 7: Verify Deployment
- [ ] Test health endpoint: `curl https://<domain>/health`
- [ ] Test API: `curl https://<domain>/api`
- [ ] Visit frontend in browser
- [ ] Check logs for errors

---

## 🧪 Post-Deployment Testing

### Basic Functionality
- [ ] Frontend loads without errors
- [ ] Can navigate between pages
- [ ] API endpoints respond correctly
- [ ] Database queries work

### User Features
- [ ] Can sign up as customer
- [ ] Can sign up as artist (with invite code)
- [ ] Can log in
- [ ] Can upload models
- [ ] Can browse models
- [ ] Can create orders

### File Operations
- [ ] Model uploads work
- [ ] Thumbnails generate
- [ ] Files are accessible via CDN
- [ ] Downloads work

### Error Handling
- [ ] Invalid requests return proper errors
- [ ] Database errors are handled
- [ ] File upload errors are handled
- [ ] Authentication errors work

---

## 📊 Monitoring

### Daily Checks
- [ ] App is running (check Railway dashboard)
- [ ] No errors in logs
- [ ] Database is responsive
- [ ] File storage has space

### Weekly Checks
- [ ] Review error logs
- [ ] Check database size
- [ ] Monitor performance metrics
- [ ] Verify backups are working

### Monthly Checks
- [ ] Review user feedback
- [ ] Check for security updates
- [ ] Update dependencies
- [ ] Review costs

---

## 🔐 Security Verification

- [ ] HTTPS is enabled (Railway provides free SSL)
- [ ] JWT_SECRET is strong and unique
- [ ] Database credentials are secure
- [ ] No secrets in code or logs
- [ ] CORS is properly configured
- [ ] Rate limiting is enabled

---

## 📞 Troubleshooting

### Build Fails
1. Check logs in Railway dashboard
2. Verify `Dockerfile` exists in root
3. Verify `package.json` scripts are correct
4. Check for syntax errors in code

### App Won't Start
1. Check environment variables are set
2. Verify DATABASE_URL is correct
3. Check logs for error messages
4. Verify migrations ran successfully

### Database Connection Error
1. Verify PostgreSQL service is running
2. Check DATABASE_URL format
3. Run migrations: `npm run migrate`
4. Check database credentials

### Frontend Not Loading
1. Verify backend is running
2. Check FRONTEND_URL is correct
3. Check browser console for errors
4. Verify static files are built

---

## 📋 Quick Reference

| Command | Purpose |
|---------|---------|
| `docker build -t artifact .` | Build Docker image locally |
| `docker-compose up` | Run full stack locally |
| `npm run migrate` | Run database migrations |
| `npm run seed` | Seed development data |
| `npm run build` | Build backend TypeScript |
| `npm run dev` | Run backend in dev mode |

---

## 🎯 Success Criteria

✅ App is deployed and accessible  
✅ Database is connected and working  
✅ Frontend loads without errors  
✅ Users can sign up and log in  
✅ File uploads work  
✅ API endpoints respond correctly  
✅ No errors in logs  
✅ HTTPS is enabled  

---

**Status**: Ready to Deploy  
**Estimated Time**: 15-20 minutes  
**Support**: Check RAILWAY_DEPLOYMENT_GUIDE.md for detailed instructions


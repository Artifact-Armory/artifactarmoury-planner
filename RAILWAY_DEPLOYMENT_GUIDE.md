# Railway Deployment Guide - Artifact Armoury Planner

**Project**: Artifact Armoury Planner  
**Platform**: Railway  
**Database**: PostgreSQL (Managed)  
**Date**: October 29, 2025

---

## 🚀 Quick Start (10 Minutes)

### Step 1: Create Railway Account

1. Go to [railway.app](https://railway.app)
2. Sign up with GitHub (recommended)
3. Create a new project

### Step 2: Connect GitHub Repository

1. In Railway dashboard, click "New Project"
2. Select "Deploy from GitHub"
3. Authorize Railway to access your GitHub
4. Select your `artifactarmoury-planner` repository
5. Click "Deploy"

### Step 3: Add PostgreSQL Database

1. In your Railway project, click "Add Service"
2. Select "PostgreSQL"
3. Railway will automatically create the database
4. Copy the `DATABASE_URL` from the PostgreSQL service variables

### Step 4: Configure Environment Variables

In Railway dashboard, go to your app service and add these variables:

```
NODE_ENV=production
PORT=3001
JWT_SECRET=<generate-with-openssl-rand-base64-32>
UPLOAD_DIR=/app/uploads
FRONTEND_URL=https://<your-railway-domain>.railway.app
BASE_URL=https://<your-railway-domain>.railway.app
EMAIL_FROM=noreply@artifactarmoury.com
STRIPE_MOCK=true
RESEND_API_KEY=<leave-empty-for-now>
```

**To generate JWT_SECRET:**
```bash
openssl rand -base64 32
```

### Step 5: Deploy

1. Railway automatically deploys when you push to main
2. Or manually trigger: Click "Deploy" in Railway dashboard
3. Wait for build to complete (2-3 minutes)
4. Check logs for any errors

### Step 6: Run Migrations

Once deployed, run migrations:

```bash
# In Railway dashboard, go to your app
# Click "Terminal" tab
# Run:
npm run migrate
```

### Step 7: Test Your Deployment

```bash
# Test health endpoint
curl https://<your-railway-domain>.railway.app/health

# Test API
curl https://<your-railway-domain>.railway.app/api
```

---

## 📋 What Gets Deployed

✅ **Backend API** (Node.js + Express)  
✅ **Frontend** (React + Vite - served by backend)  
✅ **PostgreSQL Database** (Managed by Railway)  
✅ **File Storage** (Local `/app/uploads`)  

---

## 🔧 Configuration Details

### Environment Variables

All variables are set in Railway dashboard:

| Variable | Value | Notes |
|----------|-------|-------|
| `NODE_ENV` | `production` | Required |
| `PORT` | `3001` | Railway default |
| `DATABASE_URL` | Auto-set by PostgreSQL service | Don't change |
| `JWT_SECRET` | Generate with `openssl rand -base64 32` | Min 32 chars |
| `UPLOAD_DIR` | `/app/uploads` | Persistent volume |
| `FRONTEND_URL` | Your Railway domain | For CORS |
| `BASE_URL` | Your Railway domain | For API URLs |
| `STRIPE_MOCK` | `true` | For testing without Stripe |

### Database Connection

Railway automatically provides `DATABASE_URL` when you add PostgreSQL service. The format is:

```
postgresql://user:password@host:port/database
```

Your app will automatically use this connection string.

---

## 📊 Deployment Architecture

```
┌─────────────────────────────────────────┐
│         Railway Platform                │
├─────────────────────────────────────────┤
│                                         │
│  ┌──────────────────────────────────┐  │
│  │   Your App Container             │  │
│  │  ┌────────────────────────────┐  │  │
│  │  │  Backend (Node.js)         │  │  │
│  │  │  - Express API             │  │  │
│  │  │  - Serves Frontend         │  │  │
│  │  │  - Port 3001               │  │  │
│  │  └────────────────────────────┘  │  │
│  │  ┌────────────────────────────┐  │  │
│  │  │  Frontend (React)          │  │  │
│  │  │  - Built static files      │  │  │
│  │  │  - Served by Backend       │  │  │
│  │  └────────────────────────────┘  │  │
│  └──────────────────────────────────┘  │
│                                         │
│  ┌──────────────────────────────────┐  │
│  │   PostgreSQL Database            │  │
│  │  - Managed by Railway            │  │
│  │  - Automatic backups             │  │
│  │  - Port 5432                     │  │
│  └──────────────────────────────────┘  │
│                                         │
│  ┌──────────────────────────────────┐  │
│  │   File Storage                   │  │
│  │  - /app/uploads (persistent)     │  │
│  │  - Models, images, thumbnails    │  │
│  └──────────────────────────────────┘  │
│                                         │
└─────────────────────────────────────────┘
```

---

## 🔐 Security Notes

1. **Never commit `.env.production`** to version control
2. **Use strong JWT_SECRET** - generate with `openssl rand -base64 32`
3. **Enable HTTPS** - Railway provides free SSL certificates
4. **Restrict CORS** - Set `ALLOWED_ORIGINS` to your domain
5. **Use environment variables** for all secrets

---

## 📈 Monitoring & Logs

### View Logs

1. Go to your Railway project
2. Click on your app service
3. Click "Logs" tab
4. View real-time logs

### Common Issues

**Build fails:**
- Check logs for errors
- Ensure `Dockerfile` is in root directory
- Verify `package.json` scripts exist

**Database connection fails:**
- Verify `DATABASE_URL` is set
- Check PostgreSQL service is running
- Run migrations: `npm run migrate`

**Frontend not loading:**
- Check backend is serving static files
- Verify `FRONTEND_URL` is correct
- Check browser console for errors

---

## 🚀 Next Steps

1. **Test the deployment** - Visit your Railway domain
2. **Create test accounts** - Sign up as customer and artist
3. **Upload test models** - Test file upload functionality
4. **Share with testers** - Give them your Railway domain URL
5. **Monitor logs** - Watch for errors in real-time

---

## 💾 Backups

Railway automatically backs up your PostgreSQL database:

- **Retention**: 7 days (free tier)
- **Frequency**: Daily
- **Access**: Via Railway dashboard

To manually backup:

```bash
# In Railway terminal
pg_dump $DATABASE_URL > backup.sql
```

---

## 🆘 Troubleshooting

### App won't start

```bash
# Check logs
# Look for error messages in Railway dashboard

# Common causes:
# - Missing environment variables
# - Database connection failed
# - Port already in use
```

### Database connection error

```bash
# Verify DATABASE_URL is set
# Check PostgreSQL service is running
# Run migrations: npm run migrate
```

### Frontend not loading

```bash
# Check backend is running
# Verify FRONTEND_URL matches your domain
# Check browser console for errors
```

---

## 📞 Support

- **Railway Docs**: https://docs.railway.app
- **Railway Support**: https://railway.app/support
- **Project Repo**: Your GitHub repository

---

**Status**: ✅ Ready to Deploy  
**Last Updated**: October 29, 2025


# Deployment Quick Reference - Artifact Armoury Planner

**Status**: ✅ Ready to Deploy  
**Platform**: Railway  
**Time to Deploy**: 10 minutes  
**Cost**: Free (within Railway free tier)

---

## 🚀 Deploy in 7 Steps

### 1️⃣ Create Railway Account
```
https://railway.app → Sign up with GitHub
```

### 2️⃣ Create New Project
```
New Project → Deploy from GitHub → Select artifactarmoury-planner
```

### 3️⃣ Add PostgreSQL
```
Add Service → PostgreSQL → Wait for initialization
```

### 4️⃣ Generate JWT Secret
```bash
openssl rand -base64 32
```

### 5️⃣ Set Environment Variables
```
NODE_ENV=production
PORT=3001
JWT_SECRET=<paste-from-step-4>
UPLOAD_DIR=/app/uploads
FRONTEND_URL=https://<your-railway-domain>.railway.app
BASE_URL=https://<your-railway-domain>.railway.app
EMAIL_FROM=noreply@artifactarmoury.com
STRIPE_MOCK=true
DB_POOL_MIN=5
DB_POOL_MAX=20
```

### 6️⃣ Deploy
```
Push to GitHub main → Railway auto-deploys (2-3 min)
```

### 7️⃣ Run Migrations
```
Railway Terminal → npm run migrate
```

---

## 📋 Files Created

| File | Purpose |
|------|---------|
| `Dockerfile` | Container build configuration |
| `docker-compose.yml` | Local dev environment |
| `railway.json` | Railway platform config |
| `.env.production.example` | Production env template |
| `.dockerignore` | Docker build optimization |
| `DEPLOYMENT_CHECKLIST.md` | Pre/post deployment checklist |
| `RAILWAY_DEPLOYMENT_GUIDE.md` | Detailed deployment guide |

---

## ✅ Verification

After deployment, test these:

```bash
# Health check
curl https://<your-domain>/health

# API endpoint
curl https://<your-domain>/api

# Frontend
Visit https://<your-domain> in browser
```

---

## 🔐 Security Checklist

- [ ] JWT_SECRET is strong (32+ chars)
- [ ] .env.production is in .gitignore
- [ ] STRIPE_MOCK=true (for testing)
- [ ] FRONTEND_URL matches your domain
- [ ] No secrets in code

---

## 📊 What Gets Deployed

✅ Backend API (Node.js + Express)  
✅ Frontend (React + Vite)  
✅ PostgreSQL Database (Managed)  
✅ File Storage (/app/uploads)  

---

## 💰 Cost

**Free Tier**: $5/month credit  
**Estimated Usage**: $0-2/month  
**Includes**: 1 app + 1 database + storage  

---

## 🆘 Troubleshooting

| Issue | Solution |
|-------|----------|
| Build fails | Check logs in Railway dashboard |
| DB connection error | Verify DATABASE_URL is set |
| Frontend not loading | Check backend is running |
| Migrations fail | Run: `npm run migrate` in terminal |

---

## 📚 Documentation

1. **DEPLOYMENT_CHECKLIST.md** - Step-by-step checklist
2. **RAILWAY_DEPLOYMENT_GUIDE.md** - Detailed guide
3. **.env.production.example** - Environment variables

---

## 🎯 Next Steps

1. Read DEPLOYMENT_CHECKLIST.md
2. Create Railway account
3. Deploy (10 minutes)
4. Share with testers!

---

**Ready to deploy?** Start with DEPLOYMENT_CHECKLIST.md


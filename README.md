# VP Honda — Backend API

## Local Development
```
npm install
npm run dev
```

## Deploy on Render.com (Free)
1. GitHub पर push करो
2. render.com → New Web Service → GitHub repo connect
3. Build Command: `npm install`
4. Start Command: `node server.js`
5. Environment Variables:
   - `MONGODB_URI` = MongoDB Atlas connection string
   - `FRONTEND_URL` = Vercel frontend URL

## Deploy Frontend on Vercel (Free)
1. Frontend folder GitHub पर push करो
2. vercel.com → Import → repo select
3. Environment Variable: `VITE_API_URL` = Render backend URL
 

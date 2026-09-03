# What to Watch

A shared household watchlist — Larra, Eric, or both. Type a title or snap a photo
of the TV, and it auto-fills genre, streaming service, cast, and Rotten Tomatoes
score. No Claude account needed for anyone who opens the site.

## Stack
- **Next.js** — the app itself, hosted on Vercel
- **Firestore** — the shared list, live-synced across every device
- **Firebase Storage** — reserved for future use if you want to keep uploaded photos
- **Vercel serverless functions** (`pages/api/*`) — hold your Anthropic + TMDB keys
  server-side so they're never exposed in the browser
- **TMDB** — supplies the backdrop images (Rotten Tomatoes has no public image API,
  so this is the standard source apps use alongside an RT score/link)

## 1. Firebase setup
1. Go to https://console.firebase.google.com → Create a project (free "Spark" plan is enough).
2. In the project, click **Build > Firestore Database > Create database** (start in production mode).
3. Click **Build > Storage > Get started** (accept defaults).
4. Go to **Project settings > General**, scroll to "Your apps," click the `</>` web icon, register an app (no hosting needed) — copy the `firebaseConfig` values, you'll need them below.
5. In **Firestore > Rules**, paste the contents of `firestore.rules` from this repo and publish. (This app has no login screen, so rules are open — anyone with your site's URL can read/write. Don't post the URL publicly.)

## 2. Get your API keys
- **Anthropic**: https://console.anthropic.com → API Keys → Create key.
- **TMDB** (for backdrop images, free): https://www.themoviedb.org/settings/api → request a key.

## 3. Push to GitHub
```bash
cd what-to-watch
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/what-to-watch.git
git push -u origin main
```

## 4. Deploy on Vercel
1. Go to https://vercel.com → **Add New > Project** → import the GitHub repo.
2. Before deploying, open **Environment Variables** and add all of these (copy `.env.local.example` as your checklist):
   - `ANTHROPIC_API_KEY`
   - `TMDB_API_KEY`
   - `NEXT_PUBLIC_FIREBASE_API_KEY`
   - `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
   - `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
   - `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`
   - `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`
   - `NEXT_PUBLIC_FIREBASE_APP_ID`
3. Click **Deploy**. You'll get a URL like `what-to-watch.vercel.app` — that's it, that's the app.
4. Share that URL with Eric. No sign-up, no Claude account, works on any phone or laptop.

## Local development (optional)
```bash
npm install
cp .env.local.example .env.local   # fill in real values
npm run dev
```
Visit http://localhost:3000

## Notes
- Every future `git push` to `main` auto-redeploys on Vercel.
- If you ever want to add a login so strangers can't hit your Firestore rules,
  Firebase Auth (email link or Google sign-in) is the natural next step — say
  the word and we can wire that in.

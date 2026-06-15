Deployment guide — Frontend (Vercel) + Backend (Render)
=====================================================

Overview
--------
- Frontend: deploy the React app on Vercel.
- Backend: deploy the Node.js + SQLite backend on Render.

Important note about data persistence
-----------------------------------
The backend uses SQLite and stores the DB file on disk. On Render, the filesystem is ephemeral unless you attach a Persistent Disk. You have two options:

1. Attach a Persistent Disk to your Render service and set the `DATA_DIR` environment variable to the mount path (e.g. `/data`).
2. Migrate the app to a managed database (Postgres) and update DB code accordingly.

Recommended quick approach: use Render Persistent Disk and set `DATA_DIR=/data`.

Backend — Render
-----------------
1. Create a new Web Service on Render (Manual deploy from GitHub or use the dashboard).
2. Build and Start commands (Render will run `npm install` automatically):

   Build Command: leave empty (Render will run `npm install`)
   Start Command: `npm start`

3. Environment variables (set in the Render dashboard):
   - `JWT_SECRET` — set a strong secret for JWTs
   - `DATA_DIR` — set to the mounted persistent disk path e.g. `/data`

4. In the Render service settings, add a Persistent Disk and mount it at the path you used for `DATA_DIR` (e.g. `/data`).

5. The current `start` script uses `node --experimental-sqlite src/index.js` to enable Node's `node:sqlite` experimental API; keep the default Node version Render chooses, or pin to Node 22.

6. After deploy, note the service URL (e.g. `https://flatmate-backend.onrender.com`).

Frontend — Vercel
------------------
1. On Vercel, create a new project and link your GitHub repo (or import from local).
2. In Project Settings → Environment Variables set:
   - `REACT_APP_API_URL` = the backend base URL (e.g. `https://flatmate-backend.onrender.com`) — do NOT include a trailing `/api` (the app appends `/api` itself).

3. Build & Output Settings: for Create React App, Vercel detects automatically. If needed, set:
   - Framework Preset: `Create React App`
   - Build Command: `npm run build`
   - Output Directory: `build`

4. Deploy the project. Vercel will build and host the static frontend. The running app will call `REACT_APP_API_URL + '/api/...'`.

Auto-deploy via GitHub Actions
-----------------------------
If you'd like the frontend to deploy automatically on push to `main`, add the following GitHub repository secrets:

- `VERCEL_TOKEN` — your Vercel account token (create at https://vercel.com/account/tokens)
- `VERCEL_ORG_ID` — your Vercel organization ID (available in project settings)
- `VERCEL_PROJECT_ID` — the Vercel project ID
- `REACT_APP_API_URL` — the backend URL (e.g. `https://flatmate-backend.onrender.com`)

I added a sample GitHub Actions workflow at `.github/workflows/deploy-frontend.yml` that builds `frontend/` and deploys to Vercel using these secrets. After you add the secrets, pushing to `main` will trigger a deploy and the workflow logs will show the live Vercel URL.

Local testing before deploy
---------------------------
- To test frontend against a deployed backend locally, set the env variable and run:

```
REACT_APP_API_URL=https://your-backend.onrender.com npm start
```

Or edit `.env.local` in `frontend/` with:

```
REACT_APP_API_URL=https://your-backend.onrender.com
```

Security & next steps
---------------------
- Ensure `JWT_SECRET` is set in Render.
- Consider migrating to Postgres if you need a scalable, managed database.
- Optional: add a health check endpoint and configure Render health checks.

Questions or help
-----------------
If you want, I can:
- Create a `render.yaml` for Infrastructure as Code to provision the service and disk.
- Add a simple migration to use Postgres and an environment-switchable DB layer.

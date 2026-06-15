# Flat 4B Expenses — Shared Expenses App

A full-stack shared expenses tracker built for Flat 4B (Aisha, Rohan, Priya, Meera → Sam).

## Tech Stack

- **Backend**: Node.js + Express + better-sqlite3 (SQLite)
- **Frontend**: React 18
- **Auth**: JWT (bcrypt password hashing)
- **AI used**: Claude (Anthropic) as primary dev collaborator

## Setup Instructions

### Prerequisites
- Node.js 18+
- npm

### Backend

```bash
cd backend
npm install
node src/index.js
```

Runs on http://localhost:3001

### Frontend

```bash
cd frontend
npm install
npm start        # dev server on http://localhost:3000
# OR
npm run build    # production build served by backend
```

### Running together (production)

```bash
cd frontend && npm run build
cd ../backend && node src/index.js
# App available at http://localhost:3001
```

## Demo credentials

All flat members are pre-seeded:
- **Name**: Aisha / Rohan / Priya / Meera / Sam / Dev
- **Password**: `password123`

## Import

Go to the Import tab and upload `expenses_export.csv`. The importer will:
1. Detect all anomalies
2. Surface them in a full report
3. Handle each according to documented policies (see SCOPE.md)

## AI Used

Claude (claude-sonnet-4-6) via Anthropic — see AI_USAGE.md

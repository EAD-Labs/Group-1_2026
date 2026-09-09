# EduPyramids — ET 617, Group 1

A gamified Python practice app for Grades 9–12, built as a companion to the
Spoken Tutorial Python course. Client: Mrs. Saisudha and Prof. Kannan,
Spoken Tutorial / IIT Bombay.

**Team:** Karan Bansal (24B3003) · Aditya Koli (24B3024) ·
Keshav Kumar (24B0354) · Mayank Kansal (24B3019)

## Layout

| Folder | What it is |
|---|---|
| `edupyramids-backend/` | Node/Express API, PostgreSQL schema and migrations, question importer, tests |
| `edupyramids-frontend/` | React + Vite interface for students, teachers and coordinators |

## Running it

Both halves need their own `.env`. Copy the example and fill it in — the real
files are deliberately not committed.

```bash
# Backend
cd edupyramids-backend
cp .env.example .env          # then set DB_* and JWT_SECRET
npm install
psql -d edupyramids_dev -f migrations/001_init.sql   # then 002, 003
node scripts/seed.js
node scripts/import-questions.js content/python-mcqs.json
npm start                     # http://localhost:5000

# Frontend
cd ../edupyramids-frontend
cp .env.example .env
npm install
npm run dev                   # http://localhost:5173
```

`npm test` in the backend rebuilds a separate `edupyramids_test` database and
runs the suite.

## Status

Weeks 3 and 4 of the plan in the approved HLD are complete: login for the three
roles, the database, and the quiz module marking the client's 136 questions.
Games (weeks 5–6), gamification (week 7) and dashboards (weeks 8–9) follow.


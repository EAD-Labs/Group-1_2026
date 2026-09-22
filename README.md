# EduPyramids — ET 617, Group 1

A gamified Python practice app for Grades 9–12, built as a companion to the
Spoken Tutorial Python course. Client: Mrs. Saisudha and Prof. Kannan,
Spoken Tutorial / IIT Bombay.

**Team:** Karan Bansal (24B3003) · Aditya Koli (24B3024) ·
Keshav Kumar (24B0354) · Mayank Kansal (24B3019)

**Live pilot:** https://edupyramids.onrender.com (test accounts below)

## What it does

| For | What they get |
|---|---|
| Students | Quizzes on the client's 136 questions, 21 games of 7 kinds (matching, sorting, memory tiles, fill the blank, predict the output, Parsons puzzles, bug hunt), adaptive practice that picks the next question, and a view of their progress by concept |
| Teachers | Their class: averages by topic, students who need help, the questions the class got wrong, and a students-by-concept mastery heatmap |
| Coordinators | Every class, the school database (when connected), and the question generator, which drafts questions from Spoken Tutorial videos with Gemini for a person to approve |

## Layout

| Folder | What it is |
|---|---|
| `edupyramids-backend/` | Node/Express API, PostgreSQL migrations, content files and importers, tests |
| `edupyramids-frontend/` | React + Vite interface for all three roles |
| `render.yaml` | Render Blueprint for the hosted pilot |
| `.github/workflows/ci.yml` | Tests and a build on every push and pull request |

## Running it

Both halves need their own `.env`. Copy the example and fill it in; the real
files are never committed.

```bash
# Backend
cd edupyramids-backend
cp .env.example .env          # set DB_* and JWT_SECRET (GEMINI_API_KEY is optional)
npm install
createdb edupyramids_dev
npm run migrate               # every file in migrations/, safe to repeat
npm run import content/python-mcqs.json         # also loads content/concepts.json
npm run import:games content/python-games.json
npm run seed                  # test accounts
npm start                     # http://localhost:5000

# Frontend
cd ../edupyramids-frontend
cp .env.example .env
npm install
npm run dev                   # http://localhost:5173
```

Test accounts, all with the password `password123`: `student1@school.com`,
`teacher1@school.com`, `coordinator@school.com`.

`npm test` in the backend rebuilds a separate `edupyramids_test` database and
runs the suite. The same tests run on GitHub for every push.

## Offline use

Students can turn on **Use without internet** on their Progress page. That
downloads every quiz and game, with the answers needed to mark them, about
60 KB, and the app itself is kept on the device by a service worker, so it
opens and runs with no connection. Quizzes and games are marked on the device
for instant feedback; each finished attempt waits in a queue and uploads when
the connection returns, where the server marks it again and records it with
the time it was actually done. Practice, sign-in and the staff pages still need
a connection.

It is opt-in because it puts the answers on the device: fine for a lab tablet,
and it cannot change a student's record, since the server re-marks every
upload. `edupyramids-frontend/src/offline/markers.test.js` checks that the
device marks every game exactly as the server does.

## Deploying on Render

The service was created from the public repository URL, so Render does not
redeploy on its own: after pushing to `main`, open the **edupyramids** service
and choose **Manual Deploy → Deploy latest commit**. Wait for the green tick on
the commit in GitHub first; a red cross means the tests failed.

On every start the service applies the migrations and loads any new questions
and games; content already loaded is left alone. `SEED_DEMO_DATA=true` also
creates the test accounts. Set it to `false` before real students use the app.
Question generation needs `GEMINI_API_KEY` set in the service's environment.

Free plan limits: the service sleeps after 15 minutes idle (the next visit
takes about a minute), and the free database expires after 30 days.

## Status

| HLD plan | State |
|---|---|
| Weeks 3–4: sign-in for three roles, database, quiz module | Done |
| Weeks 5–6: games | Done: 7 kinds, 21 games |
| Week 7: points, levels and badges | Next |
| Weeks 8–9: dashboards, content management | Class report, concept heatmap and question generator done; content editing to come |

Adaptive practice and generated questions go beyond the approved HLD (v2.0,
Section 13.2) and need the client's sign-off in an updated version.

Waiting on the client: school sign-in and roster APIs (see the proposal shared
on 18 September), and the mapping from their roles to ours.

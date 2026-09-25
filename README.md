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
| Students | A pyramid to build (Home): one route through the course, level by level, each level a tier and each quiz or game a brick, with a keystone challenge that opens the tier above. On it: quizzes on the client's 136 questions and 25 games of 9 kinds, from warm-ups (matching, sorting, memory) to fill the blank, Parsons puzzles, predict the output, Trace Runner, bug hunt and Bug Catcher. Stars, hints, XP, a daily goal and a school-day streak; cracked bricks to repair when a concept starts to fade; adaptive practice; and a class goal shared with classmates |
| Teachers | Their class: the weekly class goal and who has not practised yet, averages by topic, students who need help, the questions the class got wrong, and a students-by-concept mastery heatmap |
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

## How progress works

The design follows the research summarised for the course report: Duolingo's
single learning path, streaks and daily goals; intrinsic integration
(Habgood & Ainsworth); and the finding that public leaderboards discourage
weaker students.

- **Pyramid.** Each level is a tier, built from the foundation (Bronze) up to
  the capstone. A tier's bricks are its quiz, then its games from the easiest
  skill to the hardest, then a keystone (10 mixed questions, 70% to pass).
  A brick opens when the one before has a star, and is coloured by its stars
  (sandstone, bronze, gold). Anything already played stays open, and a locked
  tier can be reached by setting the keystone below it. The logic is the
  learning path in `pathService.js`; only the drawing is a pyramid, so the
  app looks like EduPyramids rather than any other learning app.
- **Stars.** One at 60%, two for everything right, three for everything right
  with no hints (and, in Bug Catcher, no more tests than par).
- **XP.** Up to 10 for finishing, in proportion to the score, plus 5 per new
  star; 20 for passing a checkpoint; 2 per practice answer. Replays of
  three-star work earn little, and empty attempts earn nothing.
- **Build streak and goal.** One finished activity keeps the day. Weekends
  never break a streak. Every 5 active days earn a shield (up to 2) that covers
  a missed school day. A fading concept shows as a cracked brick, repaired by
  a five-question review. Students pick a daily goal of 10 to 50 XP.
- **Class goal.** 60 XP per student per week, shared. Students see the total
  and their own share, never a ranking; teachers also see who has not
  practised yet.

All of it is worked out from what students actually did, in India time
(`APP_TIMEZONE`), so offline attempts count on the day they were done.

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

## Android app

The site installs as an app straight from Chrome ("Install app" in the menu).
For an APK to hand out:

1. On [pwabuilder.com](https://www.pwabuilder.com), enter the deployed URL and
   choose **Android → Generate**. It builds a signed APK (and an AAB for the Play
   Store) that opens the site full screen. Keep the signing key and its password
   it gives you: every later update must be signed with the same key.
2. From the same download, copy the package id and the key's SHA-256
   fingerprint into the Render service's environment as `ANDROID_PACKAGE` and
   `ANDROID_CERT_SHA256`. The server then answers
   `/.well-known/assetlinks.json`, which lets the app open without Chrome's
   address bar.

The APK is only a shell around the site, so it updates with every deploy and
works offline exactly as the site does.

## Deploying on Render

The service was created from the public repository URL, so Render does not
redeploy on its own: after pushing to `main`, open the **edupyramids** service
and choose **Manual Deploy → Deploy latest commit**. Wait for the green tick on
the commit in GitHub first; a red cross means the tests failed.

On every start the service applies the migrations and loads any new questions
and games; content already loaded is left alone. `SEED_DEMO_DATA=true` also
creates the test accounts. Set it to `false` before real students use the app.
Question generation needs `GEMINI_API_KEY` set in the service's environment.
It uses `GEMINI_MODEL` (default `gemini-3.5-flash-lite`). When Google answers
that the model is busy it retries twice, then tries `GEMINI_FALLBACK_MODEL` if
one is set.

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

# EduPyramids — backend

API and database for the EduPyramids Gamified Learning Companion: sign-in for
three roles, the quiz module, seven kinds of game, adaptive practice driven by
Bayesian Knowledge Tracing, class analytics, and question generation from
Spoken Tutorial videos.

Node.js + Express + PostgreSQL. Still to come: the Week 7 points, levels and
badges rules, and coordinator content editing.

## Running it

```bash
npm install
cp .env.example .env                              # then set JWT_SECRET
createdb edupyramids_dev
npm run migrate                                   # every file in migrations/, safe to repeat
npm run import content/python-mcqs.json           # loads content/concepts.json first
npm run import:games content/python-games.json
npm run seed
npm run dev                                       # http://localhost:5000
```

`npm run seed` prints the test accounts. All of them use the password
`password123`:

| Email | Role | Class |
| --- | --- | --- |
| student1@school.com | student | Grade 9-A |
| student2@school.com | student | Grade 9-A |
| student3@school.com | student | Grade 9-B (no attempts, on purpose) |
| teacher1@school.com | teacher | owns Grade 9-A |
| teacher2@school.com | teacher | owns Grade 9-B |
| coordinator@school.com | coordinator | sees every class |

Two classes with two teachers are seeded so the isolation rule can actually be
demonstrated rather than asserted.

### No PostgreSQL service?

A cluster you own, needing no root, works fine:

```bash
/usr/lib/postgresql/18/bin/initdb -D ~/.local/share/edupyramids-pg -U postgres --auth=trust
/usr/lib/postgresql/18/bin/pg_ctl -D ~/.local/share/edupyramids-pg -l /tmp/edupg.log \
  -o "-p 5432 -k /tmp/edupg-sock -c listen_addresses=127.0.0.1" start
```

## Using the school data locally

The client's decision (22 September) is to use their school data locally for
now, with no changes to their APIs. The app reads it from a read-only copy of
their database dump, in a separate database it never writes to. That powers
school sign-in, roster search and the coordinator's school panel. The hosted
pilot on Render does not have it.

```bash
# 1. Convert the MySQL dump to PostgreSQL, keeping only the tables the app reads
#    (accounts, roles, schools, batches, students, enrolments, trainings) and
#    adding the indexes its lookups need. Profiles, OTPs and sessions are left out.
python scripts/convert-school-dump.py /path/to/school_db-2026-09-01.sql school_pg.sql

# 2. Load it into its own database: about two minutes for 1.18M accounts
createdb school_db
psql -d school_db -f school_pg.sql

# 3. Point the app at it in .env, then restart
SCHOOL_DB_NAME=school_db
SCHOOL_DB_HOST=127.0.0.1
SCHOOL_DB_USER=postgres
SCHOOL_DB_PASSWORD=
```

At startup the server logs `[school-db] read-only mirror: … accounts`. The
connection is opened read-only, so a mistaken write fails instead of changing
the client's records. Neither SQL file may be committed; `.gitignore` excludes
them.

Roles come from `accounts_userrolemapping`, counting only approved mappings in
date. In the September dump that is 68,062 students, 536 school coordinators
(`main_school_coord`), 178 invigilators (treated as teachers; the one `teacher`
mapping is still pending), 5 national coordinators and 2 organisation
partners. The training tables are empty, so the dump does not yet say who is
on the Python course.

## The endpoints

All under `/api`. Everything except `POST /auth/login` and `GET /health` needs
`Authorization: Bearer <token>`.

| Area | Routes | Who |
| --- | --- | --- |
| Sign-in | `POST /auth/login`, `POST /auth/logout`, `GET /auth/me` | anyone / signed in |
| Quizzes | `GET /quizzes`, `GET /quizzes/:id`, `POST /quizzes/:id/check`, `POST /quizzes/:id/attempts` | signed in |
| Games | `GET /games`, `GET /games/:id`, `POST /games/:id/check`, `POST /games/:id/results` | signed in |
| Practice | `GET /practice/mastery`, `GET /practice/next`, `POST /practice/answer` | students |
| Progress | `GET /progress/:studentId` | self, or staff |
| Classes | `GET /classes` | scoped by role |
| Analytics | `GET /analytics/classes/:id`, `GET /analytics/classes/:id/mastery`, `GET /analytics/students/:id` | a teacher's own class, or a coordinator |
| School database | `GET /school/stats`, `GET /school/students?q=` | coordinators |
| Question generator | `GET /content/videos`, `POST /content/videos/:slug/generate`, `POST /content/generate`, `GET/PATCH /content/drafts…`, `POST /content/drafts/:id/approve`, `…/reject` | teachers, coordinators |

`GET /api/health` answers without a token, for the deploy's health check.

Games are one module per kind in `src/games`; how to add a kind is in
[`content/README.md`](content/README.md).

## Loading questions

Questions come from a JSON file. The format, and the rules the importer
enforces, are in [`content/README.md`](content/README.md).

```bash
npm run import content/sample-questions.json            # load
node scripts/import-questions.js FILE --dry-run         # check without writing
node scripts/import-questions.js FILE --replace         # reload a corrected file
```

`content/sample-questions.json` is three topics written by the team so the
import and the marking could be built and tested. **It is not course content and
must be replaced before the pilot.**

A file is validated in full before anything is written, and the write is one
transaction: a mistake in the last question leaves the database untouched.

## Marking

`POST /api/quizzes/:id/attempts` takes
`{ answers: { questionId: 'a' }, clientAttemptId }` and returns the score, the
per-question feedback and which topics to look at again.

- The student comes from the token, never the body.
- A question left blank is marked wrong, not dropped from the total.
- `clientAttemptId` is a UUID the client makes when it opens the quiz. Sending
  it twice returns the first attempt instead of recording a second.
- The answer key is not in the quiz payload; the correct answer and the
  explanation only come back once the attempt is marked.

## Tests

```bash
createdb edupyramids_test     # once
npm test
```

111 tests over sign-in, access control, quizzes, every game kind, the mastery
model, question generation (with Gemini faked) and the migrations. They run
against `edupyramids_test`, which is dropped and rebuilt on every run, so
development data is never touched and no test can pass on a leftover row. The
same suite runs on GitHub for every push (`.github/workflows/ci.yml`).

Test names carry the HLD test number they cover where there is one, so a
failure points straight at the acceptance criterion it breaks:

| Suite | Covers |
| --- | --- |
| `auth.test.js` | A1, A2: signing in, and every failure looking identical |
| `access.test.js` | A3, C5, C7, C8: who may read what, and which classes are offered |
| `quiz.test.js` | A4, A5, A6, A7, C9: loading content, marking, double submits |
| `games.test.js`, `gameKinds.test.js` | every game of every kind: no answers sent, full and empty marks, partial credit |
| `mastery.test.js` | knowledge tracing arithmetic, spaced review, practice selection, the class heatmap |
| `content.test.js` | subtitles to transcript, checking Gemini's output, draft review and approval |
| `migrations.test.js` | every migration re-runs on a database that already has data |

## Checking it works

```bash
# sign in
curl -s -X POST localhost:5000/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"student1@school.com","password":"password123","role":"student"}'

# without a token
curl -s -o /dev/null -w '%{http_code}\n' localhost:5000/api/quizzes            # 401

# a student reaching for a teacher's class report
curl -s -o /dev/null -w '%{http_code}\n' localhost:5000/api/analytics/classes/1 \
  -H "Authorization: Bearer $STUDENT_TOKEN"                                     # 403
```

## Decisions worth knowing about

These differ from the Week 3 specification draft. Each was a defect or a
contradiction with the HLD the client has already signed off.

**The migration is PostgreSQL, not MySQL.** The draft declared indexes as
`INDEX name (col)` inside `CREATE TABLE`. PostgreSQL rejects that outright, so
the file could not be run at all. Indexes are now separate `CREATE INDEX`
statements.

**One `attempts` table, not `attempts` plus `game_results`.** Quiz and game
results share a table, told apart by `kind`. This is the HLD ER diagram, and the
reason for it is that one dashboard query then covers both without
special-casing either. A second table would have meant every analytics query
being written, and tested, twice.

**Topics are a table.** The draft repeated `topic VARCHAR(100)` across five
tables, so a renamed topic would have to be corrected in five places and a typo
would silently create a new one.

**`badges` has a unique constraint** on `(student_id, topic_id, badge_name)`,
and `Badge.award` uses `ON CONFLICT DO NOTHING`. Without it, a badge can be
awarded twice, which is the failure HLD test C1 exists to catch.

**Every failed sign-in returns the same message.** The draft returned a distinct
`Role mismatch`, which confirms to anyone probing that an address exists and
what it is for. Unknown email, wrong password and wrong role tab are now
indistinguishable, per HLD test A2. The sixth failure in fifteen minutes is
throttled with a 429.

**CORS points at port 5173.** The draft set `FRONTEND_URL=http://localhost:3000`
while Vite serves on 5173, which would have blocked every browser request.

**The auth API is named for the school.** The draft used
`SPOKEN_TUTORIAL_AUTH_URL`, with a typo in the host (`spokenutorial`). HLD
Section 7.3 calls this the school authentication API and decision D-02 keeps
this phase clear of Spoken Tutorial's APIs. Left blank, the server verifies
passwords against its own `users` table and says so at startup.

**The school API call falls back rather than locking everyone out.** A 401 from
the school means the credentials are wrong. A timeout or a 500 means we do not
know, and refusing every login because their server is having a bad morning
would shut the whole school out, so those fall back to the local check and are
logged.

## Still outstanding

- School sign-in and roster APIs from the client's Django project, to replace
  the direct reads in `src/models/School.js` (proposal shared 18 September).
- The mapping from the school's roles to ours, and how teachers link to batches.
- Explanations for the client's 136 questions; the importer warns about each
  one missing.

The login and generation throttles are in memory, which is correct for one
process at pilot scale. A second instance needs them moved into the database
or a cache.

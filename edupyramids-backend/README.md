# EduPyramids — backend

API and database for the EduPyramids Gamified Learning Companion.
Week 3 deliverable: **Milestone 1, Working App Skeleton**, plus the Week 4 quiz
module and the analytics the Week 8 and 9 dashboards run on.

Node.js + Express + PostgreSQL. Games (Week 5) and the points, levels and badges
rules engine (Week 7) are the parts still to come.

## Running it

```bash
npm install
cp .env.example .env          # then set JWT_SECRET
createdb edupyramids_dev      # or: psql -U postgres -c "CREATE DATABASE edupyramids_dev;"
psql -U postgres -d edupyramids_dev -f migrations/001_init.sql
npm run seed
npm run dev                   # http://localhost:5000
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

## The endpoints

Twelve, all under `/api`. Everything except `POST /auth/login` needs
`Authorization: Bearer <token>`.

| # | Method | Path | Who | Notes |
| --- | --- | --- | --- | --- |
| 1 | POST | `/auth/login` | anyone | Returns the user and a JWT |
| 2 | POST | `/auth/logout` | signed in | The client drops the token |
| 3 | GET | `/auth/me` | signed in | Who this token belongs to |
| 4 | GET | `/quizzes` | signed in | Real query; empty until Week 4 content |
| 5 | GET | `/quizzes/:id` | signed in | Questions without the answer key |
| 6 | POST | `/quizzes/:id/attempts` | signed in | Marks and stores the attempt |
| 7 | GET | `/games` | signed in | Real query; empty until Week 5 |
| 8 | GET | `/games/:id` | signed in | |
| 9 | POST | `/games/:id/results` | signed in | `implemented: false` until Week 5 |
| 10 | GET | `/progress/:studentId` | self, or staff | Students may read only their own |
| 11 | GET | `/analytics/classes/:classId` | teacher, coordinator | A teacher only gets their own class |
| 12 | GET | `/classes` | signed in | Scoped by role: own class, or all of them |

`GET /api/health` also exists for deployment checks and is not counted.

`POST /games/:id/results` still answers `200` with `implemented: false` rather
than pretending to have saved something — game marking is Week 5. It is wired so
the client can be built against it now.

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

42 tests over the sign-in rules, access control and the quiz module. They run
against `edupyramids_test`, which is dropped and rebuilt on every run, so
development data is never touched and no test can pass on a leftover row.

Test names carry the HLD test number they cover, so a failure points straight at
the acceptance criterion it breaks:

| Suite | Covers |
| --- | --- |
| `auth.test.js` | A1, A2 — signing in, and every failure looking identical |
| `access.test.js` | A3, C5, C7, C8 — who may read what, and which classes are offered |
| `quiz.test.js` | A4, A5, A6, A7, C9 — loading content, marking, double submits |

The suite has been checked against the defect it exists to catch: putting the
draft's distinct `Role mismatch` message back fails exactly one test.

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

- The school authentication endpoint and API key, from the client.
- The student roster, for seeding real accounts.
- The MCQ content file, needed before Week 4.

The login throttle is in memory, which is correct for one process at pilot
scale. A second instance needs it moved into the database or a cache.

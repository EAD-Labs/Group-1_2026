# Acceptance tests (HLD Section 14)

Every test the HLD lists, and where it is checked. "Automated" tests run on
every push (GitHub Actions); run them locally with `npm test` in
`edupyramids-backend` and `edupyramids-frontend`. The HLD says the project is
complete when every test passes, no known problem causes a wrong score, a lost
record or data shown to the wrong person, and at most five small problems of
appearance or wording are left open.

| Status | Meaning |
|---|---|
| ✅ Automated | A test in the repository checks it on every push |
| ✅ Measured | Run with a script; the result is recorded below |
| 🖐 By hand | Needs a person, a real device or real students |

## Part 1: Logins and quizzes

| No. | What the HLD tests | Status | Where |
|---|---|---|---|
| A1 | Student logs in with the right password and sees their topics | ✅ Automated | `tests/auth.test.js` "A1 …" |
| A2 | Wrong password five times: same message, never says whether the account exists; sixth try blocked | ✅ Automated | `tests/auth.test.js` "A2 …" (four tests) |
| A3 | Student opens a teacher's class report by its address: refused, no names shown | ✅ Automated | `tests/access.test.js` "A3 …" |
| A4 | Question file loaded, then again with one damaged row: first load exact, second refused naming the row, nothing changed | ✅ Automated | `tests/quiz.test.js` "A4 loading a question file" |
| A5 | 7 of 10 right and one blank: saved as 7/10, blank counts as wrong | ✅ Automated | `tests/quiz.test.js` "A5 …" |
| A6 | Submitted twice, or refreshed and submitted: one attempt | ✅ Automated | `tests/quiz.test.js` "A6 …" |
| A7 | Three wrong, results opened: each shows the right answer and its topic | ✅ Automated | `tests/quiz.test.js` "A7 …" |

## Part 2: Games

The games are played by tapping a piece and then its place rather than by
dragging, which works the same by mouse, touch and keyboard (a decision made
during Weeks 5–6). B1, B2 and B5 are therefore checked on what a placed piece
is worth; the feel of it on a device is B3 and B4.

| No. | What the HLD tests | Status | Where |
|---|---|---|---|
| B1 | Piece placed right: stays, marked right, one point | ✅ Automated | `tests/acceptance.test.js` "B1 …" |
| B2 | Piece placed wrong: no marks, nothing saved | ✅ Automated | `tests/acceptance.test.js` "B2 …" |
| B3 | Whole game played by keyboard only | 🖐 By hand | Every piece is a real button; check each of the nine kinds with Tab and Enter |
| B4 | Game played by touch on a real tablet | 🖐 By hand | Check on a tablet: nothing scrolls by accident, text readable |
| B5 | A right piece placed ten more times: score does not go up | ✅ Automated | `tests/acceptance.test.js` "B5 …" |
| B6 | Game finished, next interrupted by a refresh: one result, points once, nothing half-saved | ✅ Automated | `tests/acceptance.test.js` "B6 …"; `tests/games.test.js` "submitting twice records one attempt" |

## Part 3: Rewards and dashboards

| No. | What the HLD tests | Status | Where |
|---|---|---|---|
| C1 | Badge earned, more work, three reloads: badge there once | ✅ Automated | `tests/badges.test.js` "C1 …" |
| C2 | Student on a higher level scores 20%: level stays | ✅ Automated | `tests/badges.test.js` "C2 …" |
| C3 | Eight activities all under 50%: no badge | ✅ Automated | `tests/badges.test.js` "C3 …" |
| C4 | Progress follows topics learnt, not time spent | ✅ Automated | `tests/acceptance.test.js` "C4 …" |
| C5 | Teacher A sees only their class; Class B's report by address refused | ✅ Automated | `tests/access.test.js` "C5 …" |
| C6 | Dashboard numbers match the saved records exactly | ✅ Automated | `tests/analytics.test.js` "the figures agree with the score the student was given" and the tests after it |
| C7 | Teacher opens a student with no attempts: "No attempts yet", no blank boxes, no error | ✅ Automated | `tests/access.test.js` "C7 …" |
| C8 | Coordinator sees every class, edits content; the edit is saved and shown to students | ✅ Automated | `tests/access.test.js` "C8 …" and `tests/manage.test.js` "C8 …" |
| C9 | Teacher downloads the class report: opens in a spreadsheet, one row per student | ✅ Automated | `edupyramids-frontend/src/utils/classCsv.test.js` "C9 …" |

## The complete app

| No. | What the HLD tests | Status | Where |
|---|---|---|---|
| D1 | Student journey: log in, quiz, game, results, badges, log out, back in; progress still there | ✅ Automated (in parts) · 🖐 once end to end | The parts are covered above; walk it once in a browser before the demo |
| D2 | Teacher journey: log in, class, one student, download report; numbers match | ✅ Automated (in parts) · 🖐 once end to end | As D1 |
| D3 | D1 on Chrome, Firefox, Edge and a tablet | 🖐 By hand | Four browsers |
| D4 | Fifty students at once: all attempts saved, pages under 3 seconds | ✅ Measured | `node scripts/load-test.js` (see below) |
| D5 | Five students and a teacher from the school, no help: four of five finish a quiz and a game alone; teacher finds a struggling student | 🖐 By hand | The classroom pilot |

## D4, measured

`node scripts/load-test.js http://localhost:5077 --students 50`, on the
development machine against the full demo data (4 classes, about 1,500
attempts), 27 September 2026:

| Page | Loads | Median | 95th | Slowest |
|---|---|---|---|---|
| Sign in | 50 | 165 ms | 241 ms | 252 ms |
| Home (four requests side by side) | 50 | 418 ms | 441 ms | 444 ms |
| Quiz lesson | 50 | 87 ms | 100 ms | 103 ms |
| Quiz result | 50 | 238 ms | 417 ms | 422 ms |
| Game | 50 | 98 ms | 179 ms | 179 ms |
| Game result | 50 | 138 ms | 157 ms | 160 ms |

All 50 quiz lessons and 50 games saved; slowest page 0.44 s against a 3 s
limit. **Passes.**

The first run of this test found a real fault: marking a quiz asked the
database pool for a second connection while holding one, so with ten students
submitting together every connection was held by an attempt waiting for
another, and the server froze. Fixed, and guarded by the test "more lesson
attempts at once than the server has connections all save" in
`tests/lessons.test.js`, which freezes on the old code.

The hosted pilot runs on Render's free plan (one small shared instance), so
its numbers will be slower than these; run the same script against a staging
copy of it before the classroom pilot. The script writes to the database it
is given and removes its temporary students afterwards: never point it at the
live site.

## Left to do by hand

B3, B4, D1 and D2 end to end, D3 and D5. Suggested order: B3 and D3 on a
laptop (an hour), B4 on a tablet, D1 and D2 as a rehearsal of the demo, and
D5 as the first day of the classroom pilot.

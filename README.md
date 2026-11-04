# EduPyramids Python Companion

**[Read the project introduction: what the app is, who it is for and why →](https://ead-labs.github.io/Group-1_2026/)**

A gamified Python practice app for students in Grades 9 to 12, built as a companion to the Spoken Tutorial Python course. ET 617 (Educational App Design), Group 1, IIT Bombay.

**Team:** Karan Bansal (24B3003) · Aditya Koli (24B3024) · Keshav Kumar (24B0354) · Mayank Kansal (24B3019)  
**Client:** Mrs. Saisudha, Prof. Kannan Moudgalya and Mrs. Ankita Singhal, EduPyramids / Spoken Tutorial, IIT Bombay  
**Instructor:** Prof. Ramkumar Rajendran

## Purpose

Young learners can lose interest in a video-plus-multiple-choice format: there is little feedback on why an answer is wrong and little reinforcement, especially for students in rural schools with short lab periods and patchy internet. This app turns the course into a route students can see themselves climbing, explains every answer, and shows teachers who needs help.

## What it does

| For | What they get |
|---|---|
| **Students** | A pyramid to build, level by level: 134 course questions in short lessons, 25 games of 9 kinds, a keystone challenge between levels, stars, badges, a daily goal and a school-day streak. Adaptive practice, with the Spoken Tutorial video for a weak concept playing in the app. Quizzes and games also work offline. |
| **Teachers** | A weekly class goal, averages by level, students who need help, the questions the class got wrong, and a mastery heatmap by student and concept. A question generator that drafts questions from Spoken Tutorial videos with Gemini, for a person to approve. |
| **Coordinators** | Every class on one page, class and account setup by pasting a list, and an editor for questions, answers and explanations. |

## Try it

| | |
|---|---|
| **Demo, with test accounts** | https://edupyramids.onrender.com (the first visit can take about a minute while the free server wakes up) |
| **Hosted by EduPyramids, for school accounts** | https://python.edupyramids.org |

Demo sign-ins, with the password `password123`. Pick the matching role on the sign-in page.

| Role | Email |
|---|---|
| Student | `student1@school.com` (fresh start), `student2@school.com` (some progress) |
| Teacher | `teacher1@school.com`, or `anjali.deshpande@demo.example` for a class with three weeks of made-up activity |
| Coordinator | Ask the team. This sign-in is not public, because it can change the demo's questions and accounts. |

## Run it yourself

**With Docker** (the app and its database):

```bash
git clone https://github.com/EAD-Labs/Group-1_2026 && cd Group-1_2026
cp .env.docker.example .env      # in .env, set DB_PASSWORD and JWT_SECRET to long random values,
                                 # and SEED_DEMO_DATA=true for test accounts (never on a real server)
docker compose up -d --build
```

Then open http://localhost:5000 and use the sign-ins above.

**Without Docker**, you need Node.js and PostgreSQL. Follow [Running it locally, in full](docs/technical-guide.md#running-it-locally-in-full).

## Repository layout

| Path | What it is |
|---|---|
| `edupyramids-backend/` | Node/Express API, PostgreSQL migrations, course content, tests |
| `edupyramids-frontend/` | React + Vite interface for all three roles |
| `docs/index.html` | The project introduction page |
| `docs/technical-guide.md` | Every feature in detail, how progress works, offline use, hosting |
| `docs/acceptance-tests.md` | Each acceptance test in the design document, and its status |
| `Dockerfile`, `docker-compose.yml`, `render.yaml` | Hosting |

## Status

Live on EduPyramids' own server since 15 October 2026. Of the 27 acceptance tests in the design document, 26 pass; the last one is use by real students. Automated tests run on GitHub for every push.

## Licence

See [LICENSE.txt](LICENSE.txt). Lesson videos are from [Spoken Tutorial, IIT Bombay](https://spoken-tutorial.org), licensed CC BY-SA 4.0.

# EduPyramids — frontend

Web client for the EduPyramids Gamified Learning Companion, for students,
teachers and coordinators. React + Vite + React Router, no UI framework. The
look follows the EduPyramids School website (school.edupyramids.org).

## Running it

The backend must be running first, on port 5000.

```bash
npm install
cp .env.example .env
npm run dev            # http://localhost:5173
```

Sign in with `student1@school.com`, `teacher1@school.com` or
`coordinator@school.com`, password `password123`. Pick the matching tab: the
role you choose has to match the account, and the server will not say which
part was wrong.

## Layout

```
src/
├── api/client.js            fetch wrapper: base URL, JWT header, 401 handling
├── components/
│   ├── DashboardShell.jsx   the frame for every page: sidebar on wide screens,
│   │                        tab bar on phones, tabs chosen by role
│   ├── Login.jsx            role tabs, validation, the sign-in call
│   ├── ClassReport.jsx      a class's figures, shared by teacher and coordinator
│   ├── MasteryHeatmap.jsx   students by concept, for teachers
│   ├── ConceptMap.jsx       a student's concepts
│   ├── GameTile.jsx         one game as a tile
│   └── …                    ProtectedRoute, ErrorBoundary, SchoolPanel
├── games/
│   ├── registry.js          every game kind: label, icon, skill, Board
│   └── <kind>/Board.jsx     one board per kind (matching, sort, memory,
│                            fillblank, predict, parsons, bughunt)
├── pages/
│   ├── StudentHome, Learn, Play, Me    the student tabs
│   ├── Quiz, Game, Practice            the activities
│   ├── TeacherDashboard, CoordinatorDash
│   └── QuestionGenerator               staff
├── styles/index.css         design tokens and every style
├── utils/auth.js            session state on top of localStorage
├── utils/useApi.js          load a page's data in one call
└── App.jsx                  routes
```

A new game kind needs a folder in `games/` and one line in `registry.js`; the
server side is described in `edupyramids-backend/content/README.md`.

## How the session works

`utils/auth.js` keeps the token, the user and the expiry in `localStorage`, so a
refresh keeps you signed in. `api/client.js` attaches the token to every
request. A 401 on any *authenticated* request clears the session and sends you
to the login page with a note saying it ended.

A 401 from `/auth/login` is deliberately excluded from that. Signing in with the
wrong password is also a 401, and treating it as an expired session would
replace "Invalid email or password" with "Your session has ended" — and would
sign out whoever was already logged in on that browser.

**`ProtectedRoute` is a convenience, not a security boundary.** Anyone can edit
`localStorage` and reach a teacher route. What actually protects the data is the
API returning 403, which it does and which is tested. The guard exists so a
student who mistypes a URL gets a clear message instead of a broken screen.

## Accessibility

- The role tabs are a real radio group with a legend, so arrow keys work and a
  screen reader announces them. The tab appearance is styling only.
- Every input has a label; errors are tied to their field with
  `aria-describedby` and marked with `aria-invalid`.
- The failed-sign-in message is a live region, so it is announced.
- Focus is always visible.
- Layout holds down to 360px.
- The spinner slows right down under `prefers-reduced-motion`.

## Colours and type

Taken from school.edupyramids.org and kept as tokens at the top of
`styles/index.css`: navy `#2E3494` for structure and links, orange `#F26321`
for the main action on a screen and for progress, amber `#F59E24` for
highlights, lavender `#EFF0FF` for the page. Roboto for text, DM Sans for
buttons and navigation. Bronze, silver and gold mark the three levels.

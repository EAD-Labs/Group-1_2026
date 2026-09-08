# EduPyramids — frontend

Web client for the EduPyramids Gamified Learning Companion.
Week 3 deliverable: **Milestone 1, Working App Skeleton**.

React + Vite + React Router. This week covers signing in, keeping the session
and routing each role to its own dashboard. The dashboards themselves are
placeholders: topics and quizzes arrive in Week 4, games in Week 5, class
analytics in Week 8.

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
├── api/client.js              fetch wrapper: base URL, JWT header, 401 handling
├── components/
│   ├── Login.jsx              role tabs, validation, the sign-in call
│   ├── ProtectedRoute.jsx     route guard
│   ├── DashboardShell.jsx     shared header and log out
│   └── ErrorBoundary.jsx      catches a render crash
├── pages/                     three dashboard placeholders
├── styles/index.css           design tokens and every style
├── utils/auth.js              session state on top of localStorage
├── App.jsx                    routes
└── main.jsx                   entry point
```

`DashboardShell.jsx` is not in the Week 3 file list. The alternative was the
same header copied into three placeholder pages that are about to be rewritten.

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

## A note on the colours

The tokens in `styles/index.css` — `#1e40af`, `#059669`, `#f97316` — are the
ones named in the Week 3 specification. Worth knowing: the Week 2 deliverables
are low-fidelity grayscale wireframes and define no palette, so despite the
specification saying "use design tokens from Week 2", this file is the first
place these colours have been written down. They are worth a look from the
client before more screens are built on them.

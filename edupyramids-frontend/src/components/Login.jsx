import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { auth } from '../utils/auth';

const ROLES = [
  { id: 'student', label: 'Student' },
  { id: 'teacher', label: 'Teacher' },
  { id: 'coordinator', label: 'Coordinator' },
];

function validate({ email, password }) {
  const errors = {};
  if (!email.trim()) errors.email = 'Enter your email address';
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.email = 'That does not look like an email address';
  }
  if (!password) errors.password = 'Enter your password';
  else if (password.length < 6) {
    errors.password = 'Passwords are at least 6 characters';
  }
  return errors;
}

export default function Login() {
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const [role, setRole] = useState('student');
  const [values, setValues] = useState({ email: '', password: '' });
  const [errors, setErrors] = useState({});
  const [touched, setTouched] = useState({});
  const [formError, setFormError] = useState(
    params.get('expired') ? 'Your session has ended. Please sign in again.' : '',
  );
  const [loading, setLoading] = useState(false);

  const set = (field) => (event) => {
    const next = { ...values, [field]: event.target.value };
    setValues(next);
    if (touched[field]) setErrors(validate(next));
  };

  const blur = (field) => () => {
    setTouched((t) => ({ ...t, [field]: true }));
    setErrors(validate(values));
  };

  async function submit(event) {
    event.preventDefault();
    const found = validate(values);
    setErrors(found);
    setTouched({ email: true, password: true });
    if (Object.keys(found).length) return;

    setFormError('');
    setLoading(true);
    try {
      const user = await auth.login(values.email.trim(), values.password, role);
      navigate(auth.homeFor(user.role), { replace: true });
    } catch (err) {
      // The server deliberately gives one message for every kind of failed
      // sign-in, so it is shown as-is rather than guessed at.
      setFormError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth">
      <form className="card auth-card" onSubmit={submit} noValidate>
        <header className="auth-head">
          <p className="brand">
            <img src="/edupyramids-logo.png" alt="EduPyramids" width="440" height="336" />
          </p>
          <h1>Sign in</h1>
          <p className="muted">Python practice for Grades 9&ndash;12</p>
        </header>

        {/* Radios, not buttons: a radio group is what a screen reader and the
            arrow keys already understand. The tab look is styling only. */}
        <fieldset className="tabs">
          <legend className="sr-only">I am signing in as</legend>
          {ROLES.map((r) => (
            <label
              key={r.id}
              className={`tab${role === r.id ? ' tab--on' : ''}`}
            >
              <input
                type="radio"
                name="role"
                value={r.id}
                checked={role === r.id}
                onChange={() => setRole(r.id)}
                className="sr-only"
              />
              {r.label}
            </label>
          ))}
        </fieldset>

        {formError && (
          <p className="alert" role="alert">{formError}</p>
        )}

        <div className="field">
          <label htmlFor="email">Email address</label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            value={values.email}
            onChange={set('email')}
            onBlur={blur('email')}
            aria-invalid={Boolean(touched.email && errors.email)}
            aria-describedby={touched.email && errors.email ? 'email-error' : undefined}
            disabled={loading}
          />
          {touched.email && errors.email && (
            <p className="field-error" id="email-error">{errors.email}</p>
          )}
        </div>

        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            value={values.password}
            onChange={set('password')}
            onBlur={blur('password')}
            aria-invalid={Boolean(touched.password && errors.password)}
            aria-describedby={
              touched.password && errors.password ? 'password-error' : undefined
            }
            disabled={loading}
          />
          {touched.password && errors.password && (
            <p className="field-error" id="password-error">{errors.password}</p>
          )}
        </div>

        <button className="btn" type="submit" disabled={loading}>
          {loading && <span className="spinner" aria-hidden="true" />}
          {loading ? 'Signing in…' : 'Sign in'}
        </button>

        <p className="muted small">
          Test accounts: student1@school.com, teacher1@school.com,
          coordinator@school.com &mdash; password <code>password123</code>
        </p>
      </form>
    </main>
  );
}

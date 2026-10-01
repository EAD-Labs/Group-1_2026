import { useState } from 'react';
import DashboardShell from '../components/DashboardShell';
import { client } from '../api/client';
import { auth } from '../utils/auth';

/*
 * Change your own password, for every role. A starting password handed out by
 * the coordinator ("mango-river-42") is meant to be replaced here. Changing it
 * signs out every other session, so a password someone else saw stops working
 * on their device too; this one carries on with the fresh token the server
 * sends back.
 */
export default function Account() {
  const user = auth.getCurrentUser();
  const [form, setForm] = useState({ current: '', next: '', again: '' });
  const [state, setState] = useState({ busy: false, error: '', done: false });
  const set = (name) => (e) => setForm({ ...form, [name]: e.target.value });

  async function save(e) {
    e.preventDefault();
    if (form.next !== form.again) {
      setState({ busy: false, error: 'The two new passwords are not the same', done: false });
      return;
    }
    setState({ busy: true, error: '', done: false });
    try {
      const data = await client.post('/auth/password', { currentPassword: form.current, newPassword: form.next });
      auth.setToken(data.token);
      setForm({ current: '', next: '', again: '' });
      setState({ busy: false, error: '', done: true });
    } catch (err) {
      setState({ busy: false, error: err.message, done: false });
    }
  }

  return (
    <DashboardShell title="Your account">
      <section className="card account-card">
        <p className="muted">Signed in as <strong>{user?.name}</strong> ({user?.email}).</p>
        <h2 className="h2">Change your password</h2>
        <p className="muted small">
          If someone gave you a starting password, change it to one only you know.
          Changing it signs you out everywhere else.
        </p>
        {state.error && <p className="alert" role="alert">{state.error}</p>}
        {state.done && <p className="manage-notice" role="status">Your password has been changed.</p>}
        <form onSubmit={save}>
          <div className="field">
            <label htmlFor="pw-current">Current password</label>
            <input id="pw-current" type="password" autoComplete="current-password" required
              value={form.current} onChange={set('current')} />
          </div>
          <div className="field">
            <label htmlFor="pw-next">New password (at least 8 characters)</label>
            <input id="pw-next" type="password" autoComplete="new-password" required minLength={8} maxLength={72}
              value={form.next} onChange={set('next')} />
          </div>
          <div className="field">
            <label htmlFor="pw-again">New password again</label>
            <input id="pw-again" type="password" autoComplete="new-password" required minLength={8} maxLength={72}
              value={form.again} onChange={set('again')} />
          </div>
          <button className="btn" type="submit" disabled={state.busy}>
            {state.busy ? 'Changing…' : 'Change password'}
          </button>
        </form>
      </section>
    </DashboardShell>
  );
}

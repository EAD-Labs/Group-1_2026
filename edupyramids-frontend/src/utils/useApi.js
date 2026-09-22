import { useEffect, useState } from 'react';
import { client } from '../api/client';

/**
 * Load several API paths at once for a page.
 *
 * Paths marked optional (a leading "?") fall back to an empty list when they
 * fail, so a page still shows its main content if, say, games cannot load.
 *
 *   const { loading, error, data: [progress, games] } = useApi([`/progress/${id}`, '?/games']);
 */
export function useApi(paths) {
  const key = paths.join('|');
  const [state, setState] = useState({ loading: true, error: null, data: [] });

  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    Promise.all(paths.map((p) => (p.startsWith('?')
      ? client.get(p.slice(1)).catch(() => ({ data: [] }))
      : client.get(p))))
      .then((results) => live && setState({ loading: false, error: null, data: results.map((r) => r.data) }))
      .catch((err) => live && setState({ loading: false, error: err.message, data: [] }));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return state;
}

/** Topic icons. A topic the client adds later falls back to a book. */
const TOPIC_ICONS = {
  'Bronze Level': '🥉',
  'Silver Level': '🥈',
  'Gold Level': '🥇',
  'Post-test': '🎓',
  'Spoken Tutorial videos': '🎬',
};
export const topicIcon = (name) => TOPIC_ICONS[name] || '📘';

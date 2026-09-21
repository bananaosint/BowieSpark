import { useCallback, useEffect, useState } from 'react';
import { api, apiPost, apiPatch, apiDelete } from '../lib/api.js';
import SessionForm from '../components/SessionForm.jsx';
import RosterPanel from '../components/RosterPanel.jsx';

const keyOf = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// FIT doesn't run at weekends, so defaulting to "today" on a Saturday drops a
// teacher onto a date where the roster is empty and every action is refused.
// Roll forward to the next school day instead.
function defaultDate() {
  const d = new Date();
  const dow = d.getDay();
  if (dow === 6) d.setDate(d.getDate() + 2);
  else if (dow === 0) d.setDate(d.getDate() + 1);
  return keyOf(d);
}

function isWeekend(dateKey) {
  const [y, m, dd] = dateKey.split('-').map(Number);
  const dow = new Date(y, m - 1, dd).getDay();
  return dow === 0 || dow === 6;
}

export default function TeacherHome() {
  const [sessions, setSessions] = useState(null);
  const [tags, setTags] = useState([]);
  const [date, setDate] = useState(defaultDate());
  const [selectedId, setSelectedId] = useState(null);
  const [editing, setEditing] = useState(null); // null | 'new' | session
  const [error, setError] = useState(null);
  const [flash, setFlash] = useState(null);

  // Fetch and state-write are split so the effect can drop a response that
  // arrived after the user already moved to another date. Writing inside the
  // fetch helper put the setState calls outside the effect's `cancelled`
  // guard, letting a slow response for an old date overwrite a newer one.
  const fetchData = useCallback(async (forDate) => {
    const [s, t] = await Promise.all([
      api(`/teacher/sessions?date=${forDate}`),
      api('/subject-tags'),
    ]);
    return { sessions: s.sessions, tags: t.subjectTags };
  }, []);

  const load = useCallback(
    async (forDate) => {
      const data = await fetchData(forDate);
      setSessions(data.sessions);
      setTags(data.tags);
      return data.sessions;
    },
    [fetchData]
  );

  useEffect(() => {
    let cancelled = false;
    fetchData(date)
      .then((data) => {
        if (cancelled) return;
        setSessions(data.sessions);
        setTags(data.tags);
        // Keep the current selection if it still exists, else pick the first.
        setSelectedId((cur) =>
          data.sessions.some((s) => s.id === cur) ? cur : data.sessions[0]?.id ?? null
        );
      })
      .catch((err) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [fetchData, date]);

  const selected = sessions?.find((s) => s.id === selectedId) ?? null;

  async function saveSession(values, existing) {
    const res = existing
      ? await apiPatch(`/teacher/sessions/${existing.id}`, values)
      : await apiPost('/teacher/sessions', values);
    const list = await load(date);
    setEditing(null);
    setFlash(existing ? 'Session updated.' : 'Session created.');
    setSelectedId(res.session?.id ?? list[0]?.id ?? null);
  }

  async function removeSession(session) {
    setError(null);
    setFlash(null);
    try {
      await apiDelete(`/teacher/sessions/${session.id}`);
      const list = await load(date);
      setSelectedId(list[0]?.id ?? null);
      setFlash(`"${session.title}" was archived.`);
    } catch (err) {
      setError(err.message);
    }
  }

  if (error && !sessions) return <p className="error">{error}</p>;
  if (!sessions) return <p className="muted">Loading your sessions…</p>;

  return (
    <section>
      <h2>Teaching</h2>

      {flash ? <p className="flash">{flash}</p> : null}
      {error ? <p className="error">{error}</p> : null}

      <div className="toolbar">
        <label className="field field--inline">
          <span className="field__label">Date</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        {isWeekend(date) ? (
          <p className="muted small toolbar__note">
            {date} is a weekend — FIT doesn&rsquo;t run, so rosters are empty and students
            can&rsquo;t be assigned. Pick a weekday.
          </p>
        ) : null}
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => {
            setEditing('new');
            setFlash(null);
          }}
        >
          New session
        </button>
      </div>

      {editing ? (
        <SessionForm
          // Without a key React reuses the mounted instance when `editing`
          // goes truthy -> truthy (session A -> session B, or A -> 'new').
          // The useState initializers never re-run, so the heading and the
          // save target follow the NEW session while every field still holds
          // the OLD one's values — and Save writes A's data onto B.
          key={editing === 'new' ? 'new' : editing.id}
          tags={tags}
          session={editing === 'new' ? null : editing}
          onCancel={() => setEditing(null)}
          onSave={saveSession}
        />
      ) : null}

      <div className="split">
        <aside className="split__list">
          <h3 className="split__head">Your sessions ({sessions.length})</h3>
          {sessions.length === 0 ? (
            <p className="muted">
              You haven&rsquo;t created any sessions yet. Use <strong>New session</strong> above.
            </p>
          ) : (
            <ul className="sesslist">
              {sessions.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    className={[
                      'sesslist__item',
                      s.id === selectedId ? 'is-active' : '',
                      s.active === false ? 'is-archived' : '',
                    ].join(' ')}
                    onClick={() => setSelectedId(s.id)}
                  >
                    <span className="sesslist__title">{s.title}</span>
                    <span className="sesslist__meta">
                      {s.subjectTag?.name} · {s.enrolledCount}/{s.capacity}
                      {s.runsOnDate === false ? ' · not this day' : ''}
                      {s.active === false ? ' · archived' : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <div className="split__detail">
          {selected ? (
            <RosterPanel
              session={selected}
              date={date}
              onEdit={() => setEditing(selected)}
              onDelete={() => removeSession(selected)}
              onChanged={async () => {
                await load(date);
              }}
            />
          ) : (
            <p className="muted">Select a session to see its roster.</p>
          )}
        </div>
      </div>
    </section>
  );
}

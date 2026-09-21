import { useCallback, useEffect, useRef, useState } from 'react';
import { api, apiPost, apiDelete } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';

const ATTENDANCE = ['present', 'tardy', 'absent', 'cut'];

export default function RosterPanel({ session, date, onEdit, onDelete, onChanged }) {
  const { user } = useAuth();
  // Teachers assign but cannot un-assign (the v1 scope choice). Admins act
  // org-wide, so the escape hatch for a mis-assignment lives with them.
  const canClear = user?.role === 'admin';
  const [roster, setRoster] = useState(null);
  const [error, setError] = useState(null);
  const [flash, setFlash] = useState(null);
  const [busyId, setBusyId] = useState(null);

  // Override picker
  const [showAssign, setShowAssign] = useState(false);
  const [query, setQuery] = useState('');
  const [found, setFound] = useState([]);
  const [picked, setPicked] = useState([]);
  const [assigning, setAssigning] = useState(false);

  // Monotonic request id: a slow roster fetch for the previously selected
  // session must not land after the user has switched, or attendance buttons
  // would be rendered from one session's rows while writing to another's.
  const requestRef = useRef(0);

  const load = useCallback(async () => {
    const ticket = ++requestRef.current;
    setError(null);
    try {
      const res = await api(`/teacher/sessions/${session.id}/roster?date=${date}`);
      if (ticket !== requestRef.current) return;
      setRoster(res);
    } catch (err) {
      if (ticket !== requestRef.current) return;
      setError(err.message);
      setRoster(null);
    }
  }, [session.id, date]);

  useEffect(() => {
    // Clear immediately so the previous session's roster is never shown under
    // the new session's heading while the next fetch is in flight.
    setRoster(null);
    setFlash(null);
    setShowAssign(false);
    setPicked([]);
    setQuery('');
    setFound([]);
    load();
  }, [load]);

  // Debounced student search for the override picker.
  useEffect(() => {
    if (!showAssign) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const res = await api(`/teacher/students?q=${encodeURIComponent(query)}`);
        if (!cancelled) setFound(res.students);
      } catch {
        if (!cancelled) setFound([]);
      }
    }, 220);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, showAssign]);

  async function clearRow(row) {
    const who = row.student?.displayName ?? 'this student';
    if (!window.confirm(`Clear ${who}'s place on ${date}? They will be free to choose again.`)) return;
    setBusyId(row.enrollmentId);
    setError(null);
    try {
      const res = await apiDelete(`/admin/enrollments/${row.enrollmentId}`);
      setFlash(res.message);
      await load();
      await onChanged?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  async function mark(row, status) {
    setBusyId(row.enrollmentId);
    setError(null);
    try {
      await apiPost('/teacher/attendance', { enrollmentId: row.enrollmentId, status });
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  async function assign() {
    setAssigning(true);
    setError(null);
    setFlash(null);
    try {
      const res = await apiPost(`/teacher/sessions/${session.id}/override`, {
        studentIds: picked.map((p) => p.id),
        date,
      });
      // The endpoint reports per student, so a partial success stays legible
      // rather than collapsing into one vague message.
      const results = res.results ?? [];
      const ok = results.filter((r) => r.assigned);
      const skipped = results.filter((r) => !r.assigned);
      setFlash(
        `Assigned ${ok.length} student${ok.length === 1 ? '' : 's'}.` +
          (skipped.length
            ? ` Skipped ${skipped.length}: ${skipped
                .map((s) => `${s.displayName ?? s.studentId} (${s.reason})`)
                .join(', ')}`
            : '')
      );
      setPicked([]);
      setShowAssign(false);
      await load();
      await onChanged?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setAssigning(false);
    }
  }

  const rows = roster?.roster ?? [];

  return (
    <div className="panel">
      <div className="panel__bar">
        <h3 className="panel__head">{session.title}</h3>
        <div className="panel__actions">
          <button type="button" className="btn" onClick={onEdit}>
            Edit
          </button>
          <button type="button" className="btn" onClick={onDelete}>
            Archive
          </button>
        </div>
      </div>

      <p className="muted panel__sub">
        {session.subjectTag?.name} · capacity {session.capacity} ·{' '}
        {session.recurrenceType === 'daily' ? 'every school day' : session.days.join(', ')}
      </p>

      {flash ? <p className="flash">{flash}</p> : null}
      {error ? <p className="error">{error}</p> : null}

      {/* Two different reasons a day can be empty, and they need different
          fixes from the teacher, so say which one it is. */}
      {roster && roster.dayCode === null ? (
        <p className="notice notice--plain">
          {date} isn&rsquo;t a school day, so there is no FIT to run. Choose a weekday.
        </p>
      ) : roster && roster.runsOnDate === false ? (
        <p className="notice notice--plain">
          &ldquo;{session.title}&rdquo; doesn&rsquo;t meet on {date} (it runs{' '}
          {session.recurrenceType === 'daily' ? 'every school day' : session.days.join(', ')}).
          Pick a day it runs to take attendance or assign students.
        </p>
      ) : null}

      <div className="panel__bar">
        <h4 className="panel__subhead">
          Roster for {date} ({rows.length}/{session.capacity})
        </h4>
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => setShowAssign((v) => !v)}
        >
          {showAssign ? 'Close' : 'Assign students'}
        </button>
      </div>

      {showAssign ? (
        <div className="assign">
          <p className="assign__note">
            Assigning a student replaces whatever they picked for {date} and locks it — they
            can&rsquo;t change it themselves. You can only assign into your own sessions.
          </p>
          <label className="field">
            <span className="field__label">Find a student</span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Type a name or email"
              autoComplete="off"
            />
          </label>

          {picked.length ? (
            <div className="assign__picked">
              {picked.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="chip chip--on"
                  onClick={() => setPicked((cur) => cur.filter((x) => x.id !== p.id))}
                  title="Remove"
                >
                  {p.displayName} ✕
                </button>
              ))}
            </div>
          ) : null}

          <ul className="assign__results">
            {found
              .filter((f) => !picked.some((p) => p.id === f.id))
              .map((f) => (
                <li key={f.id}>
                  <button
                    type="button"
                    className="assign__result"
                    onClick={() => setPicked((cur) => [...cur, f])}
                  >
                    <strong>{f.displayName}</strong> <span className="muted">{f.email}</span>
                  </button>
                </li>
              ))}
            {found.length === 0 ? <li className="muted">No students match.</li> : null}
          </ul>

          <button
            type="button"
            className="btn btn--primary"
            disabled={!picked.length || assigning}
            onClick={assign}
          >
            {assigning ? 'Assigning…' : `Assign ${picked.length || ''}`.trim()}
          </button>
        </div>
      ) : null}

      {!roster ? (
        <p className="muted">Loading roster…</p>
      ) : rows.length === 0 ? (
        <p className="muted">Nobody is signed up for this day yet.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Student</th>
              <th>How</th>
              <th>Attendance</th>
              {canClear ? <th>Admin</th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.enrollmentId}>
                <td>
                  <strong>{row.student?.displayName ?? row.displayName}</strong>
                  <br />
                  <span className="muted small">{row.student?.email ?? row.email}</span>
                </td>
                <td>
                  {row.status === 'teacher_override' ? (
                    <span className="pill">assigned</span>
                  ) : (
                    <span className="muted small">chose it</span>
                  )}
                </td>
                <td>
                  <div className="attendance">
                    {ATTENDANCE.map((s) => (
                      <button
                        key={s}
                        type="button"
                        className={`attbtn${row.attendance?.status === s ? ' is-on' : ''}`}
                        // Which mark is recorded was conveyed only by a CSS
                        // class, so a screen reader announced four identical
                        // buttons with no way to tell which one was chosen.
                        aria-pressed={row.attendance?.status === s}
                        disabled={busyId === row.enrollmentId}
                        onClick={() => mark(row, s)}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </td>
                {canClear ? (
                  <td className="nowrap">
                    <button
                      type="button"
                      className="btn btn--sm"
                      disabled={busyId === row.enrollmentId}
                      onClick={() => clearRow(row)}
                      title="Free this student to choose again for this day"
                    >
                      Clear
                    </button>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

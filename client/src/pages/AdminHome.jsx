import { useCallback, useEffect, useState } from 'react';
import { api, apiPost, apiPatch, apiPut, apiDelete } from '../lib/api.js';

const SECTIONS = [
  ['tags', 'Subject tabs'],
  ['policy', 'Wording'],
  ['cutoff', 'Signup cutoff'],
  ['users', 'Accounts'],
  ['analytics', 'Analytics'],
];

export default function AdminHome() {
  const [section, setSection] = useState('tags');
  const [error, setError] = useState(null);
  const [flash, setFlash] = useState(null);

  const say = (msg) => {
    setFlash(msg);
    setError(null);
  };
  const oops = (err) => {
    setError(err.message);
    setFlash(null);
  };

  return (
    <section>
      <h2>Admin</h2>

      <nav className="tabs">
        {SECTIONS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={section === key ? 'is-active' : ''}
            onClick={() => {
              setSection(key);
              setError(null);
              setFlash(null);
            }}
          >
            {label}
          </button>
        ))}
      </nav>

      {flash ? <p className="flash">{flash}</p> : null}
      {error ? <p className="error">{error}</p> : null}

      {section === 'tags' ? <TagsPanel say={say} oops={oops} /> : null}
      {section === 'policy' ? <PolicyPanel say={say} oops={oops} /> : null}
      {section === 'cutoff' ? <CutoffPanel say={say} oops={oops} /> : null}
      {section === 'users' ? <UsersPanel say={say} oops={oops} /> : null}
      {section === 'analytics' ? <AnalyticsPanel oops={oops} /> : null}
    </section>
  );
}

/* ------------------------------------------------------------- subject tabs */

function TagsPanel({ say, oops }) {
  const [tags, setTags] = useState(null);
  const [name, setName] = useState('');

  const load = useCallback(async () => {
    try {
      setTags((await api('/admin/subject-tags')).subjectTags);
    } catch (err) {
      oops(err);
      // Leaving this null would keep the panel on "Loading…" forever,
      // underneath an error banner explaining that it already failed.
      setTags([]);
    }
  }, [oops]);

  useEffect(() => {
    load();
  }, [load]);

  async function add(e) {
    e.preventDefault();
    try {
      await apiPost('/admin/subject-tags', { name: name.trim() });
      setName('');
      say('Subject tab added.');
      await load();
    } catch (err) {
      oops(err);
    }
  }

  async function rename(tag) {
    const next = window.prompt('Rename this subject tab', tag.name);
    if (next === null || next.trim() === tag.name) return;
    try {
      await apiPatch(`/admin/subject-tags/${tag.id}`, { name: next.trim() });
      say('Renamed.');
      await load();
    } catch (err) {
      oops(err);
    }
  }

  // Reorder by swapping with a neighbour, then sending the full order. The
  // endpoint rewrites sortOrder wholesale so the list can never end up with
  // duplicate or gapped positions.
  async function move(index, delta) {
    const next = [...tags];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setTags(next);
    try {
      await apiPut('/admin/subject-tags/reorder', { orderedIds: next.map((t) => t.id) });
    } catch (err) {
      oops(err);
      await load();
    }
  }

  async function remove(tag) {
    if (!window.confirm(`Delete "${tag.name}"? This cannot be undone.`)) return;
    try {
      await apiDelete(`/admin/subject-tags/${tag.id}`);
      say('Deleted.');
      await load();
    } catch (err) {
      oops(err);
    }
  }

  async function toggleActive(tag) {
    try {
      await apiPatch(`/admin/subject-tags/${tag.id}`, { active: !tag.active });
      say(tag.active ? 'Hidden from students.' : 'Shown to students.');
      await load();
    } catch (err) {
      oops(err);
    }
  }

  if (!tags) return <p className="muted">Loading…</p>;

  return (
    <div className="panel">
      <p className="muted panel__sub">
        These are the tabs students browse by. Order here is the order they see.
      </p>

      <table className="table">
        <thead>
          <tr>
            <th>Order</th>
            <th>Name</th>
            <th>Sessions</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {tags.map((tag, i) => (
            <tr key={tag.id} className={tag.active ? '' : 'is-dim'}>
              <td className="nowrap">
                <button className="iconbtn" type="button" disabled={i === 0} onClick={() => move(i, -1)} title="Move up">
                  ↑
                </button>
                <button
                  className="iconbtn"
                  type="button"
                  disabled={i === tags.length - 1}
                  onClick={() => move(i, 1)}
                  title="Move down"
                >
                  ↓
                </button>
              </td>
              <td>
                <strong>{tag.name}</strong>
                {tag.active ? null : <span className="muted small"> · hidden</span>}
              </td>
              <td>{tag.sessionCount}</td>
              <td className="nowrap">
                <button className="btn btn--sm" type="button" onClick={() => rename(tag)}>
                  Rename
                </button>
                <button className="btn btn--sm" type="button" onClick={() => toggleActive(tag)}>
                  {tag.active ? 'Hide' : 'Show'}
                </button>
                <button className="btn btn--sm" type="button" onClick={() => remove(tag)}>
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <form className="toolbar" onSubmit={add}>
        <label className="field field--inline">
          <span className="field__label">New tab</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={40}
            placeholder="e.g. Health Sciences"
            required
          />
        </label>
        <button type="submit" className="btn btn--primary">
          Add
        </button>
      </form>
    </div>
  );
}

/* --------------------------------------------------------------- policy text */

function PolicyPanel({ say, oops }) {
  const [rows, setRows] = useState(null);
  const [draft, setDraft] = useState({});

  const load = useCallback(async () => {
    try {
      const res = await api('/admin/policy-text');
      setRows(res.policyText);
      setDraft(Object.fromEntries(res.policyText.map((r) => [r.key, r.value])));
    } catch (err) {
      oops(err);
      setRows([]);
    }
  }, [oops]);

  useEffect(() => {
    load();
  }, [load]);

  async function save(key) {
    try {
      await apiPut(`/admin/policy-text/${key}`, { value: draft[key] });
      say('Wording updated. Students see this immediately.');
      await load();
    } catch (err) {
      oops(err);
    }
  }

  if (!rows) return <p className="muted">Loading…</p>;

  return (
    <div className="panel">
      <p className="muted panel__sub">
        Wording students are shown. Editable here so it can be changed without a code deploy.
      </p>
      {rows.map((row) => (
        <div key={row.key} className="policyrow">
          <label className="field">
            <span className="field__label">{row.key.replace(/_/g, ' ')}</span>
            <textarea
              rows={3}
              value={draft[row.key] ?? ''}
              onChange={(e) => setDraft((d) => ({ ...d, [row.key]: e.target.value }))}
            />
          </label>
          <div className="panel__actions">
            <button
              type="button"
              className="btn btn--primary"
              disabled={draft[row.key] === row.value}
              onClick={() => save(row.key)}
            >
              Save
            </button>
            {row.updatedBy ? (
              <span className="muted small">Last changed by {row.updatedBy.displayName}</span>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

/* --------------------------------------------------------------- cutoff */

function CutoffPanel({ say, oops }) {
  const [cfg, setCfg] = useState(null);
  const [rule, setRule] = useState('T-0');
  const [bell, setBell] = useState('09:30');

  const load = useCallback(async () => {
    try {
      const res = await api('/admin/cutoff');
      setCfg(res);
      setRule(res.global?.cutoffRule ?? 'T-0');
      setBell(res.global?.bellTime ?? '09:30');
    } catch (err) {
      oops(err);
      setCfg({ global: null, perSession: [] });
    }
  }, [oops]);

  useEffect(() => {
    load();
  }, [load]);

  async function save(e) {
    e.preventDefault();
    try {
      await apiPut('/admin/cutoff', { cutoffRule: rule, bellTime: bell });
      say('Cutoff saved.');
      await load();
    } catch (err) {
      oops(err);
    }
  }

  if (!cfg) return <p className="muted">Loading…</p>;

  return (
    <div className="panel">
      <p className="muted panel__sub">
        When students stop being able to change their pick. Currently:{' '}
        <strong>{cfg.global?.description}</strong>
      </p>

      <form className="formgrid" onSubmit={save}>
        <label className="field">
          <span className="field__label">Rule</span>
          <select value={rule} onChange={(e) => setRule(e.target.value)}>
            <option value="T-0">Until the bell on the day</option>
            <option value="T-1@21:00">9:00pm the night before</option>
            <option value="T-1@17:00">5:00pm the night before</option>
            <option value="T-2@17:00">5:00pm two days before</option>
          </select>
        </label>
        <label className="field">
          <span className="field__label">Bell time</span>
          <input type="time" value={bell} onChange={(e) => setBell(e.target.value)} />
          <span className="field__hint">Used when the rule is &ldquo;until the bell&rdquo;.</span>
        </label>
        <div className="formgrid__wide panel__actions">
          <button type="submit" className="btn btn--primary">
            Save cutoff
          </button>
        </div>
      </form>

      {cfg.perSession?.length ? (
        <>
          <h4 className="panel__subhead">Per-session overrides</h4>
          <table className="table">
            <thead>
              <tr>
                <th>Session</th>
                <th>Rule</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {cfg.perSession.map((p) => (
                <tr key={p.id}>
                  <td>{p.session?.title ?? p.sessionId}</td>
                  <td>{p.description}</td>
                  <td>
                    <button
                      type="button"
                      className="btn btn--sm"
                      onClick={async () => {
                        try {
                          await apiDelete(`/admin/cutoff/${p.sessionId}`);
                          say('Override removed — that session follows the global rule again.');
                          await load();
                        } catch (err) {
                          oops(err);
                        }
                      }}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : (
        <p className="muted small">No per-session overrides. Every session follows the rule above.</p>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- accounts */

function UsersPanel({ say, oops }) {
  const [users, setUsers] = useState(null);
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set('q', q.trim());
      if (role) params.set('role', role);
      setUsers((await api(`/admin/users?${params}`)).users);
    } catch (err) {
      oops(err);
      setUsers([]);
    }
  }, [q, role, oops]);

  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [load]);

  async function patch(user, body, msg) {
    try {
      await apiPatch(`/admin/users/${user.id}`, body);
      say(msg);
      await load();
    } catch (err) {
      oops(err);
    }
  }

  return (
    <div className="panel">
      <p className="muted panel__sub">
        Staff accounts land here inactive — there is no email verification yet, so somebody has
        to vouch for them before they can sign in.
      </p>

      <div className="toolbar">
        <label className="field field--inline">
          <span className="field__label">Search</span>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Name or email"
          />
        </label>
        <label className="field field--inline">
          <span className="field__label">Role</span>
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="">All</option>
            <option value="student">Students</option>
            <option value="teacher">Teachers</option>
            <option value="admin">Admins</option>
          </select>
        </label>
      </div>

      {!users ? (
        <p className="muted">Loading…</p>
      ) : users.length === 0 ? (
        <p className="muted">No accounts match.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Role</th>
              <th>Activity</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className={u.active ? '' : 'is-dim'}>
                <td>
                  <strong>{u.displayName}</strong>
                  <br />
                  <span className="muted small">{u.email}</span>
                </td>
                <td>
                  <span className="pill">{u.role}</span>
                  {u.active ? null : <span className="muted small"> · inactive</span>}
                </td>
                <td className="small muted">
                  {u.role === 'student'
                    ? `${u.enrollmentCount} signups`
                    : `${u.sessionCount} sessions`}
                </td>
                <td className="nowrap">
                  <button
                    type="button"
                    className="btn btn--sm"
                    onClick={() =>
                      patch(
                        u,
                        { active: !u.active },
                        u.active ? `${u.displayName} deactivated.` : `${u.displayName} activated.`
                      )
                    }
                  >
                    {u.active ? 'Deactivate' : 'Activate'}
                  </button>
                  {u.role !== 'admin' ? (
                    <button
                      type="button"
                      className="btn btn--sm"
                      onClick={() => patch(u, { role: 'admin' }, `${u.displayName} is now an admin.`)}
                    >
                      Make admin
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- analytics */

function shiftDays(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

function AnalyticsPanel({ oops }) {
  // Default window spans both directions. A purely backward-looking range
  // shows nothing during a beta whose scheduling all sits in the week ahead.
  const [from, setFrom] = useState(shiftDays(-30));
  const [to, setTo] = useState(shiftDays(7));
  const [data, setData] = useState(null);

  const load = useCallback(async () => {
    try {
      setData(await api(`/admin/analytics?from=${from}&to=${to}`));
    } catch (err) {
      oops(err);
      setData({ usageBySubject: [], usageByTeacher: [], unscheduledStudents: [] });
    }
  }, [from, to, oops]);

  useEffect(() => {
    load();
  }, [load]);

  if (!data) return <p className="muted">Loading…</p>;

  const att = data.attendanceBreakdown ?? {};
  const attTotal = Object.values(att).reduce((a, b) => a + b, 0);

  return (
    <div className="panel">
      <div className="toolbar">
        <label className="field field--inline">
          <span className="field__label">From</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="field field--inline">
          <span className="field__label">To</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>

      <div className="stats">
        <Stat label="Sessions" value={data.totalSessions} />
        <Stat label="Students scheduled" value={data.totalStudents} />
        <Stat label="Signups" value={data.totalEnrollments} />
        <Stat
          label="No-show rate"
          value={attTotal ? `${Math.round((data.noShowRate ?? 0) * 100)}%` : '—'}
        />
      </div>

      <h4 className="panel__subhead">By subject</h4>
      <table className="table">
        <thead>
          <tr>
            <th>Subject</th>
            <th>Sessions</th>
            <th>Signups</th>
          </tr>
        </thead>
        <tbody>
          {(data.usageBySubject ?? []).map((r) => (
            <tr key={r.subjectTag?.id ?? r.subjectTag?.name}>
              <td>{r.subjectTag?.name}</td>
              <td>{r.sessionCount}</td>
              <td>{r.enrollmentCount}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h4 className="panel__subhead">By teacher</h4>
      <table className="table">
        <thead>
          <tr>
            <th>Teacher</th>
            <th>Sessions</th>
            <th>Signups</th>
          </tr>
        </thead>
        <tbody>
          {(data.usageByTeacher ?? []).map((r) => (
            <tr key={r.teacher?.id ?? r.teacher?.displayName}>
              <td>{r.teacher?.displayName}</td>
              <td>{r.sessionCount}</td>
              <td>{r.enrollmentCount}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h4 className="panel__subhead">Attendance</h4>
      {attTotal === 0 ? (
        <p className="muted small">No attendance recorded in this range yet.</p>
      ) : (
        <div className="stats">
          {['present', 'tardy', 'absent', 'cut'].map((k) => (
            <Stat key={k} label={k} value={att[k] ?? 0} />
          ))}
        </div>
      )}

      <h4 className="panel__subhead">Students who missed scheduling</h4>
      {(data.unscheduledStudents ?? []).length === 0 ? (
        <p className="muted small">Everyone scheduled on every school day in this range.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Student</th>
              <th>School days with no pick</th>
            </tr>
          </thead>
          <tbody>
            {data.unscheduledStudents.map((r) => (
              <tr key={r.student?.id ?? r.student?.displayName}>
                <td>{r.student?.displayName}</td>
                <td>{r.missedDays}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="stat">
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  );
}

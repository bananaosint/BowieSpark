import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, apiPost, apiDelete } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import SessionCard from '../components/SessionCard.jsx';

const DAY_LABEL = { MON: 'Mon', TUE: 'Tue', WED: 'Wed', THU: 'Thu', FRI: 'Fri' };

export default function StudentHome() {
  const { user } = useAuth();
  const [week, setWeek] = useState(null);
  const [tags, setTags] = useState([]);
  const [activeDate, setActiveDate] = useState(null);
  const [activeTagId, setActiveTagId] = useState(null);
  const [teacherQuery, setTeacherQuery] = useState('');
  const [browse, setBrowse] = useState(null);
  const [savingId, setSavingId] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [flash, setFlash] = useState(null);
  // Two separate slots on purpose. `fatalError` means the week itself never
  // loaded and there is nothing to show. `browseError` is a transient failure
  // of one session query — it must NOT unmount the weekstrip and tabs, because
  // those are the only controls that can trigger a retry.
  const [fatalError, setFatalError] = useState(null);
  const [browseError, setBrowseError] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  // Only students hold enrollments. Staff can look, but the controls are dead
  // and say why rather than failing on click.
  const canEnroll = user?.role === 'student';

  const loadWeek = useCallback(async (anchor) => {
    const res = await api(`/me/week${anchor ? `?date=${anchor}` : ''}`);
    setWeek(res);
    return res;
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [weekRes, tagRes] = await Promise.all([api('/me/week'), api('/subject-tags')]);
        if (cancelled) return;
        setWeek(weekRes);
        setTags(tagRes.subjectTags);
        const today = weekRes.days.find((d) => d.isToday) ?? weekRes.days[0];
        setActiveDate((cur) => cur ?? today?.date ?? null);
      } catch (err) {
        if (!cancelled) setFatalError(err.message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const activeDay = week?.days.find((d) => d.date === activeDate) ?? null;

  // Re-fetch whenever the day, the tab, or a successful write changes things.
  // Skipped on override days — those show only the assigned session.
  useEffect(() => {
    if (!activeDate || activeDay?.isOverridden) {
      setBrowse(null);
      return;
    }
    let cancelled = false;
    setBrowse(null);
    setBrowseError(null);
    (async () => {
      try {
        const params = new URLSearchParams({ date: activeDate });
        if (activeTagId) params.set('subjectTagId', activeTagId);
        const res = await api(`/sessions?${params}`);
        if (!cancelled) setBrowse(res);
      } catch (err) {
        if (!cancelled) setBrowseError(err.message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeDate, activeTagId, activeDay?.isOverridden, reloadKey]);

  const query = teacherQuery.trim().toLowerCase();
  const visible = useMemo(() => {
    const all = browse?.sessions ?? [];
    if (!query) return all;
    return all.filter((s) => (s.teacher?.displayName ?? '').toLowerCase().includes(query));
  }, [browse, query]);

  async function signUp(session) {
    setSavingId(session.id);
    setActionError(null);
    setFlash(null);
    try {
      await apiPost('/enrollments', { sessionId: session.id, date: activeDate });
      await loadWeek(activeDate);
      setReloadKey((k) => k + 1); // refresh seat counts
      setFlash(`You're signed up for ${session.title}.`);
    } catch (err) {
      setActionError(err.message);
      // The server is the authority on cutoffs and capacity — if it refused,
      // our view of the day is stale, so resync rather than leave a lie up.
      await loadWeek(activeDate).catch(() => {});
      setReloadKey((k) => k + 1);
    } finally {
      setSavingId(null);
    }
  }

  async function cancelPick() {
    setSavingId('cancel');
    setActionError(null);
    setFlash(null);
    try {
      await apiDelete(`/enrollments/${activeDate}`);
      await loadWeek(activeDate);
      setReloadKey((k) => k + 1);
      setFlash('Your pick was cancelled.');
    } catch (err) {
      setActionError(err.message);
      await loadWeek(activeDate).catch(() => {});
    } finally {
      setSavingId(null);
    }
  }

  if (fatalError) return <p className="error">{fatalError}</p>;
  if (!week) return <p className="muted">Loading your week…</p>;

  const currentPickId = activeDay?.enrollment?.session?.id ?? null;

  return (
    <section>
      <h2>Your week</h2>
      <div className="weekstrip">
        {week.days.map((day) => (
          <button
            key={day.date}
            type="button"
            className={[
              'weekstrip__day',
              day.date === activeDate ? 'is-active' : '',
              day.isToday ? 'is-today' : '',
            ].join(' ')}
            onClick={() => {
              setActiveDate(day.date);
              setActionError(null);
              setFlash(null);
            }}
          >
            <span className="weekstrip__dow">{DAY_LABEL[day.dayCode]}</span>
            <span className="weekstrip__date">{day.date.slice(5)}</span>
            <span className="weekstrip__pick">
              {day.enrollment ? day.enrollment.session.title : 'No pick yet'}
            </span>
            {day.isOverridden ? <span className="weekstrip__lock">assigned</span> : null}
          </button>
        ))}
      </div>

      {activeDay ? (
        <div className="day">
          <h3>
            {DAY_LABEL[activeDay.dayCode]} {activeDay.date}
            {activeDay.isToday ? <span className="pill pill--today">Today</span> : null}
          </h3>

          {flash ? <p className="flash">{flash}</p> : null}
          {actionError ? <p className="error">{actionError}</p> : null}

          {activeDay.isOverridden ? (
            <>
              <div className="notice">
                <span className="notice__head">Teacher assigned</span>
                <p className="notice__body">{week.overrideNotice}</p>
              </div>
              <SessionCard session={activeDay.enrollment.session} locked defaultExpanded />
            </>
          ) : (
            <>
              <div className="pickbar">
                {activeDay.enrollment ? (
                  <>
                    <span className="muted">
                      Current pick: <strong>{activeDay.enrollment.session.title}</strong>
                    </span>
                    {canEnroll && !activeDay.locked ? (
                      <button
                        type="button"
                        className="btn"
                        onClick={cancelPick}
                        disabled={savingId === 'cancel'}
                      >
                        {savingId === 'cancel' ? 'Cancelling…' : 'Cancel pick'}
                      </button>
                    ) : null}
                  </>
                ) : (
                  <span className="muted">
                    You haven&rsquo;t picked a session for this day yet.
                  </span>
                )}
              </div>

              {activeDay.pastCutoff ? (
                <p className="notice notice--plain">
                  Signups for this day are closed.{' '}
                  {activeDay.cutoff?.description ?? ''} You can still see what&rsquo;s on, but
                  the choice is locked in now.
                </p>
              ) : null}

              <nav className="tabs">
                <button
                  type="button"
                  className={!activeTagId ? 'is-active' : ''}
                  onClick={() => setActiveTagId(null)}
                >
                  All
                </button>
                {tags.map((tag) => (
                  <button
                    key={tag.id}
                    type="button"
                    className={activeTagId === tag.id ? 'is-active' : ''}
                    onClick={() => setActiveTagId(tag.id)}
                  >
                    {tag.name}
                  </button>
                ))}
              </nav>

              <div className="searchbar">
                <label className="searchbar__label" htmlFor="teacher-search">
                  Search by teacher
                </label>
                <input
                  id="teacher-search"
                  type="search"
                  className="searchbar__input"
                  value={teacherQuery}
                  placeholder="e.g. Cowlin"
                  autoComplete="off"
                  onChange={(e) => setTeacherQuery(e.target.value)}
                />
                {query ? (
                  <>
                    <button
                      type="button"
                      className="searchbar__clear"
                      onClick={() => setTeacherQuery('')}
                    >
                      Clear
                    </button>
                    <span className="searchbar__count">
                      {visible.length} of {browse?.sessions.length ?? 0}
                    </span>
                  </>
                ) : null}
              </div>

              {browseError ? (
                <p className="error">
                  Couldn&rsquo;t load sessions for this day. {browseError} Pick another day or
                  tab to try again.
                </p>
              ) : !browse ? (
                <p className="muted">Loading sessions…</p>
              ) : !browse.isSchoolDay ? (
                <p className="muted">No FIT on this day.</p>
              ) : browse.sessions.length === 0 ? (
                <p className="muted">No sessions in this subject run on this day.</p>
              ) : visible.length === 0 ? (
                <p className="muted">
                  No sessions on this day are taught by anyone matching{' '}
                  <strong>“{teacherQuery.trim()}”</strong>.{' '}
                  <button type="button" className="linkish" onClick={() => setTeacherQuery('')}>
                    Clear the search
                  </button>{' '}
                  to see all {browse.sessions.length}.
                </p>
              ) : (
                <div className="cards">
                  {visible.map((s) => (
                    <SessionCard
                      key={s.id}
                      session={s}
                      onSignUp={canEnroll ? signUp : undefined}
                      isCurrentPick={s.id === currentPickId}
                      busy={savingId === s.id}
                      disabledReason={
                        canEnroll ? null : 'Only students can sign up for FIT sessions.'
                      }
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import SessionCard from '../components/SessionCard.jsx';

const DAY_LABEL = { MON: 'Mon', TUE: 'Tue', WED: 'Wed', THU: 'Thu', FRI: 'Fri' };

export default function StudentHome() {
  const [week, setWeek] = useState(null);
  const [tags, setTags] = useState([]);
  const [activeDate, setActiveDate] = useState(null);
  const [activeTagId, setActiveTagId] = useState(null);
  const [teacherQuery, setTeacherQuery] = useState('');
  const [browse, setBrowse] = useState(null);
  // Two separate slots on purpose. `fatalError` means the week itself never
  // loaded and there is nothing to show. `browseError` is a transient failure
  // of one session query — it must NOT unmount the weekstrip and tabs, because
  // those are the only controls that can trigger a retry.
  const [fatalError, setFatalError] = useState(null);
  const [browseError, setBrowseError] = useState(null);

  // Week + tabs load once; both are stable for the whole visit.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [weekRes, tagRes] = await Promise.all([api('/me/week'), api('/subject-tags')]);
        if (cancelled) return;
        setWeek(weekRes);
        setTags(tagRes.subjectTags);
        const today = weekRes.days.find((d) => d.isToday) ?? weekRes.days[0];
        setActiveDate(today?.date ?? null);
      } catch (err) {
        if (!cancelled) setFatalError(err.message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const activeDay = week?.days.find((d) => d.date === activeDate) ?? null;

  // Re-fetch whenever the day or the tab changes. Skipped on override days —
  // those show only the assigned session, so there is nothing to browse.
  useEffect(() => {
    if (!activeDate || activeDay?.isOverridden) {
      setBrowse(null);
      return;
    }
    let cancelled = false;
    // Drop the previous day's results immediately so stale sessions can never
    // render under the new day's heading while the next query is in flight.
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
  }, [activeDate, activeTagId, activeDay?.isOverridden]);

  // Teacher search runs over the day's already-fetched sessions. It is one
  // day's worth of rows, so a server round-trip would buy nothing, and it
  // composes with the subject tab rather than replacing it.
  const query = teacherQuery.trim().toLowerCase();
  const visible = useMemo(() => {
    const all = browse?.sessions ?? [];
    if (!query) return all;
    return all.filter((s) => (s.teacher?.displayName ?? '').toLowerCase().includes(query));
  }, [browse, query]);

  if (fatalError) return <p className="error">{fatalError}</p>;
  if (!week) return <p className="muted">Loading your week…</p>;

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
            onClick={() => setActiveDate(day.date)}
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

          {activeDay.isOverridden ? (
            <>
              <div className="notice">
                <span className="notice__head">Teacher assigned</span>
                <p className="notice__body">{week.overrideNotice}</p>
              </div>
              {/* Mandatory and the only thing on this day, so it opens up front. */}
              <SessionCard session={activeDay.enrollment.session} locked defaultExpanded />
            </>
          ) : (
            <>
              {activeDay.enrollment ? (
                <p className="muted">
                  Current pick: <strong>{activeDay.enrollment.session.title}</strong>
                </p>
              ) : (
                <p className="muted">You haven&rsquo;t picked a session for this day yet.</p>
              )}

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
                // Scoped to this panel — the weekstrip above still works, so
                // picking another day or tab retries on its own.
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
                // Distinct from the line above: sessions DO run today, the
                // search is what emptied the list.
                <p className="muted">
                  No sessions on this day are taught by anyone matching{' '}
                  <strong>“{teacherQuery.trim()}”</strong>.{' '}
                  <button
                    type="button"
                    className="linkish"
                    onClick={() => setTeacherQuery('')}
                  >
                    Clear the search
                  </button>{' '}
                  to see all {browse.sessions.length}.
                </p>
              ) : (
                <div className="cards">
                  {visible.map((s) => (
                    <SessionCard key={s.id} session={s} />
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

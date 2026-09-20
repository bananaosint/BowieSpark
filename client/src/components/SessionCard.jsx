import { useState } from 'react';

const WEEK = [
  ['MON', 'M'],
  ['TUE', 'T'],
  ['WED', 'W'],
  ['THU', 'Th'],
  ['FRI', 'F'],
];

export default function SessionCard({ session, locked = false, defaultExpanded = false }) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  // Always render the full Mon–Fri run and light up the days this session
  // meets, so two cards can be compared at a glance.
  const runsOn = (code) =>
    session.recurrenceType === 'daily' || session.days.includes(code);

  const panelId = `session-panel-${session.id}`;
  const showFullFlag = session.isFull && !locked;

  return (
    <article
      className={[
        'card',
        showFullFlag ? 'card--full' : '',
        expanded ? 'card--open' : '',
      ].join(' ').trim()}
    >
      {/* Collapsed view is title + teacher only. The heading wraps the button
          rather than the other way round, and the trigger cannot wrap the whole
          card because the footer holds its own button. */}
      <h3 className="card__heading">
        <button
          type="button"
          className="card__toggle"
          aria-expanded={expanded}
          aria-controls={panelId}
          onClick={() => setExpanded((open) => !open)}
        >
          <span className="card__titles">
            <span className="card__title">{session.title}</span>
            <span className="card__teacher">
              {session.teacher?.displayName ?? 'Unassigned'}
            </span>
          </span>
          {/* Availability is the one thing worth surfacing while collapsed —
              otherwise a student opens a card only to find it unavailable. The
              dimming alone conveys nothing to a screen reader. */}
          {showFullFlag ? <span className="card__flag">Full</span> : null}
          <span className="card__chev" aria-hidden="true" />
        </button>
      </h3>

      <div className="card__panel" id={panelId} hidden={!expanded}>
        <div className="card__band">
          <span className="card__tag">{session.subjectTag?.name ?? 'Other'}</span>
          <span className={`seats${showFullFlag ? ' seats--full' : ''}`}>
            {locked ? (
              // A locked assignment is not a seat the student can take or lose,
              // so availability is noise here.
              'Assigned to you'
            ) : session.isFull ? (
              'Full'
            ) : (
              <>
                <strong>{session.seatsLeft}</strong> of {session.capacity} open
              </>
            )}
          </span>
        </div>

        {session.description ? <p className="card__desc">{session.description}</p> : null}

        {session.prerequisites ? (
          // Build sheet §3: display-only. Never a signup gate.
          <p className="card__prereq">
            <span className="card__prereq-label">Prerequisites</span>
            {session.prerequisites}
          </p>
        ) : null}

        <footer className="card__foot">
          <span
            className="card__days"
            title={
              session.recurrenceType === 'daily'
                ? 'Meets every school day'
                : 'Meets on the highlighted days'
            }
          >
            {WEEK.map(([code, short]) => (
              <span key={code} className={`card__day${runsOn(code) ? ' card__day--on' : ''}`}>
                {short}
              </span>
            ))}
          </span>
          <button type="button" disabled title="Signing up is not wired up yet">
            {locked ? 'Locked' : 'Sign up'}
          </button>
        </footer>
      </div>
    </article>
  );
}

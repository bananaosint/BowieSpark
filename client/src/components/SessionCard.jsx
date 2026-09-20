const WEEK = [
  ['MON', 'M'],
  ['TUE', 'T'],
  ['WED', 'W'],
  ['THU', 'Th'],
  ['FRI', 'F'],
];

export default function SessionCard({ session, locked = false }) {
  // Always render the full Mon–Fri run and light up the days this session
  // meets, so two cards can be compared at a glance.
  const runsOn = (code) =>
    session.recurrenceType === 'daily' || session.days.includes(code);

  return (
    <article className={`card${session.isFull ? ' card--full' : ''}`}>
      <div className="card__band">
        <span className="card__tag">{session.subjectTag?.name ?? 'Other'}</span>
        <span className={`seats${session.isFull && !locked ? ' seats--full' : ''}`}>
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

      <header className="card__head">
        <h3 className="card__title">{session.title}</h3>
        <p className="card__teacher">{session.teacher?.displayName ?? 'Unassigned'}</p>
      </header>

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
          title={session.recurrenceType === 'daily' ? 'Meets every school day' : 'Meets on the highlighted days'}
        >
          {WEEK.map(([code, short]) => (
            <span key={code} className={`card__day${runsOn(code) ? ' card__day--on' : ''}`}>
              {short}
            </span>
          ))}
        </span>
        <button type="button" disabled title="Signing up is not wired up in the skeleton">
          {locked ? 'Locked' : 'Sign up'}
        </button>
      </footer>
    </article>
  );
}

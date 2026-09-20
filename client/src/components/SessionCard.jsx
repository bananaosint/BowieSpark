const DAY_SHORT = { MON: 'M', TUE: 'T', WED: 'W', THU: 'Th', FRI: 'F' };

export default function SessionCard({ session, locked = false }) {
  return (
    <article className={`card${session.isFull ? ' card--full' : ''}`}>
      <header className="card__head">
        <h3 className="card__title">{session.title}</h3>
        <span className={`seats${session.isFull ? ' seats--full' : ''}`}>
          {session.isFull ? 'Full' : `${session.seatsLeft} of ${session.capacity} open`}
        </span>
      </header>

      <p className="card__teacher">
        {session.teacher?.displayName ?? 'Unassigned'}
        {session.subjectTag ? <> &middot; {session.subjectTag.name}</> : null}
      </p>

      {session.description ? <p className="card__desc">{session.description}</p> : null}

      {session.prerequisites ? (
        // Build sheet §3: display-only. Never a signup gate.
        <p className="card__prereq">
          <strong>Prerequisites:</strong> {session.prerequisites}
        </p>
      ) : null}

      <footer className="card__foot">
        <span className="card__days">
          {session.recurrenceType === 'daily'
            ? 'Every day'
            : session.days.map((d) => DAY_SHORT[d] ?? d).join(' · ')}
        </span>
        <button type="button" disabled title="Signing up is not wired up in the skeleton">
          {locked ? 'Locked' : 'Sign up'}
        </button>
      </footer>
    </article>
  );
}

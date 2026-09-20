import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function prettyDate(key) {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return `${DOW[date.getDay()]} ${key}`;
}

export default function SchedulePage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api('/enrollments/history?limit=200')
      .then((res) => !cancelled && setData(res))
      .catch((err) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="muted">Loading your schedule…</p>;

  const rows = data.enrollments ?? [];
  // The endpoint returns newest first; split on today so "what's coming" reads
  // forwards and "what happened" reads backwards, which is how people think
  // about each.
  const upcoming = rows.filter((r) => r.date >= data.today).slice().reverse();
  const past = rows.filter((r) => r.date < data.today);

  return (
    <section>
      <h2>My schedule</h2>

      <h3 className="panel__subhead">Coming up ({upcoming.length})</h3>
      {upcoming.length === 0 ? (
        <p className="muted">
          Nothing booked yet. Head to <strong>My FIT</strong> to pick your sessions.
        </p>
      ) : (
        <ScheduleTable rows={upcoming} showAttendance={false} />
      )}

      <h3 className="panel__subhead">Past ({past.length})</h3>
      {past.length === 0 ? (
        <p className="muted">No past sessions yet.</p>
      ) : (
        <ScheduleTable rows={past} showAttendance />
      )}
    </section>
  );
}

function ScheduleTable({ rows, showAttendance }) {
  return (
    <table className="table">
      <thead>
        <tr>
          <th>Day</th>
          <th>Session</th>
          <th>Teacher</th>
          <th>How</th>
          {showAttendance ? <th>Attendance</th> : null}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id}>
            <td className="nowrap">{prettyDate(row.date)}</td>
            <td>
              <strong>{row.session?.title}</strong>
              <br />
              <span className="muted small">{row.session?.subjectTag}</span>
            </td>
            <td className="small">{row.session?.teacher}</td>
            <td>
              {row.status === 'teacher_override' ? (
                <span className="pill">assigned</span>
              ) : (
                <span className="muted small">you chose it</span>
              )}
            </td>
            {showAttendance ? (
              <td>
                {row.attendance?.status ? (
                  <span className={`attmark attmark--${row.attendance.status}`}>
                    {row.attendance.status}
                  </span>
                ) : (
                  <span className="muted small">not recorded</span>
                )}
              </td>
            ) : null}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

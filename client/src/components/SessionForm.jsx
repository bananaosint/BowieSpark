import { useState } from 'react';

const DAYS = [
  ['MON', 'Mon'],
  ['TUE', 'Tue'],
  ['WED', 'Wed'],
  ['THU', 'Thu'],
  ['FRI', 'Fri'],
];

const WORD_LIMIT = 50;
const countWords = (text) => (text.trim() ? text.trim().split(/\s+/).length : 0);

export default function SessionForm({ tags, session, onSave, onCancel }) {
  const [title, setTitle] = useState(session?.title ?? '');
  const [subjectTagId, setSubjectTagId] = useState(session?.subjectTag?.id ?? tags[0]?.id ?? '');
  const [capacity, setCapacity] = useState(session?.capacity ?? 20);
  const [recurrenceType, setRecurrenceType] = useState(session?.recurrenceType ?? 'daily');
  const [days, setDays] = useState(session?.days ?? []);
  const [description, setDescription] = useState(session?.description ?? '');
  const [prerequisites, setPrerequisites] = useState(session?.prerequisites ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const words = countWords(description);
  const overLimit = words > WORD_LIMIT;

  function toggleDay(code) {
    setDays((cur) => (cur.includes(code) ? cur.filter((d) => d !== code) : [...cur, code]));
  }

  async function submit(e) {
    e.preventDefault();
    setError(null);
    // Mirror the server's rules so the common mistakes are caught before a
    // round trip. The server still enforces them — this is not the gate.
    if (overLimit) return setError(`Description is ${words} words; the limit is ${WORD_LIMIT}.`);
    if (recurrenceType === 'specific_days' && days.length === 0) {
      return setError('Pick at least one day, or switch to "Every school day".');
    }
    setBusy(true);
    try {
      await onSave(
        {
          title: title.trim(),
          subjectTagId,
          capacity: Number(capacity),
          recurrenceType,
          days: recurrenceType === 'specific_days' ? days : [],
          description: description.trim(),
          prerequisites: prerequisites.trim(),
        },
        session
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel panel--form" onSubmit={submit}>
      <h3 className="panel__head">{session ? `Edit "${session.title}"` : 'New session'}</h3>

      {error ? <p className="error">{error}</p> : null}

      <div className="formgrid">
        <label className="field formgrid__wide">
          <span className="field__label">Title</span>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            maxLength={120}
            placeholder="e.g. Cowlin's Cosmic Study Lab"
          />
        </label>

        <label className="field">
          <span className="field__label">Subject tab</span>
          <select value={subjectTagId} onChange={(e) => setSubjectTagId(e.target.value)} required>
            {tags.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span className="field__label">Capacity</span>
          <input
            type="number"
            min={1}
            max={500}
            value={capacity}
            onChange={(e) => setCapacity(e.target.value)}
            required
          />
        </label>

        <label className="field">
          <span className="field__label">Meets</span>
          <select value={recurrenceType} onChange={(e) => setRecurrenceType(e.target.value)}>
            <option value="daily">Every school day</option>
            <option value="specific_days">Specific days</option>
          </select>
        </label>

        {recurrenceType === 'specific_days' ? (
          <fieldset className="field formgrid__wide daypicker">
            <legend className="field__label">Which days</legend>
            <div className="daypicker__row">
              {DAYS.map(([code, label]) => (
                <label key={code} className={`daychip${days.includes(code) ? ' is-on' : ''}`}>
                  <input
                    type="checkbox"
                    checked={days.includes(code)}
                    onChange={() => toggleDay(code)}
                  />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}

        <label className="field formgrid__wide">
          <span className="field__label">Description</span>
          <textarea
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What happens in this session?"
          />
          <span className={`field__hint${overLimit ? ' field__hint--bad' : ''}`}>
            {words} / {WORD_LIMIT} words
          </span>
        </label>

        <label className="field formgrid__wide">
          <span className="field__label">Prerequisites</span>
          <input
            type="text"
            value={prerequisites}
            onChange={(e) => setPrerequisites(e.target.value)}
            placeholder="e.g. Must be enrolled in Band"
          />
          <span className="field__hint">
            Shown to students for information only — it does not block anyone from signing up.
          </span>
        </label>
      </div>

      <div className="panel__actions">
        <button type="submit" className="btn btn--primary" disabled={busy || overLimit}>
          {busy ? 'Saving…' : session ? 'Save changes' : 'Create session'}
        </button>
        <button type="button" className="btn" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}

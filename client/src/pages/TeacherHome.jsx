import Placeholder from '../components/Placeholder.jsx';

export default function TeacherHome() {
  return (
    <Placeholder
      title="Teacher dashboard"
      blurb="Route shell only. The data model behind all of this is already migrated — these are the endpoints and screens still to build."
      items={[
        'Create / edit sessions (title, capacity, recurrence, 50-word description, prerequisites)',
        'Override tool — assign students, replacing their self-selected pick for that date',
        'Take attendance: present / tardy / absent / cut',
        'Roster and pending requests for your own sessions',
      ]}
    />
  );
}

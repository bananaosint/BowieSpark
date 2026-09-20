import Placeholder from '../components/Placeholder.jsx';

export default function AdminHome() {
  return (
    <Placeholder
      title="Admin dashboard"
      blurb="Route shell only. CutoffConfig, PolicyText and SubjectTag rows are seeded and queryable — the management UI is next."
      items={[
        'Signup cutoff configuration (global, and per-session overrides)',
        'Subject tab management — add / rename / reorder',
        'PolicyText editing, e.g. the teacher-override notice',
        'Analytics: usage by department, no-show trends, students who never schedule',
        'Account management for beta test users',
      ]}
    />
  );
}

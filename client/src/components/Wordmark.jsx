import logo from '../assets/sparky-logo.png';

// The app title appears in three different header states (offline, signed out,
// signed in), so it lives here rather than being pasted three times.
//
// The mascot is decorative: the name sits right beside it in text, so giving
// the image alt text would just make a screen reader say "Bowie Spark" twice.
export default function Wordmark() {
  return (
    <h1 className="wordmark">
      <img className="wordmark__logo" src={logo} alt="" width="52" height="55" />
      <span className="wordmark__name">Bowie Spark</span>
    </h1>
  );
}

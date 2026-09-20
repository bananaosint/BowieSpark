// Route shells for the flows the skeleton deliberately leaves unbuilt.
export default function Placeholder({ title, blurb, items }) {
  return (
    <section className="placeholder">
      <h2>{title}</h2>
      <p className="placeholder__blurb">{blurb}</p>
      <ul className="placeholder__list">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}

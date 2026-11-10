// A status shown as a coloured pill; the colour comes from the status's name (b-on-hold, b-approved, ...) in app.css
export default function Badge({ status }) {
  const k = String(status || '').toLowerCase().replace(/[^a-z]+/g, '-');
  return <span className={`badge b-${k}`}>{status}</span>;
}

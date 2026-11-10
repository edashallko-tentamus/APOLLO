// A titled part of a page: heading, optional help text and buttons on the right, then its content.
// card: draws it in a card (the usual case); off for a section already inside one.
export default function Section({ title, help, actions, card = true, className = '', children }) {
  const body = <>
    <div className="shead">
      <div><h2>{title}</h2>{help && <div className="help">{help}</div>}</div>
      {actions && <div>{actions}</div>}
    </div>
    {children}
  </>;
  return card ? <div className={`card ${className}`.trim()}>{body}</div> : body;
}

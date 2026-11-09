// Page title, optional subtitle and the page's buttons on the right.
// shortcut: no audit-trail icon yet; it comes with DataGrid (the audit dialog is a grid), before any record page moves.
export default function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="phead">
      <div><h1>{title}</h1>{subtitle && <div className="sub">{subtitle}</div>}</div>
      {actions && <div className="pactions">{actions}</div>}
    </div>
  );
}

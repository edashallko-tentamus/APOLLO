// Page title (with the audit-trail icon when the page has an audit scope), subtitle and the page's buttons.
// audit: { kind, id } for a record page, { kind } for a list page (scopes are defined by the backend's audit module).
// The title wears its menu item's icon (beside the title, so the title's text is unchanged).
import { iconFor } from '../../../public/js/icons.js';
import { useHashRoute } from '../router/useHashRoute.js';
import { activeMenuItem } from '../shell/Nav.jsx';
import AuditButton from './audit/AuditButton.jsx';

export default function PageHeader({ title, subtitle, actions, audit }) {
  const item = activeMenuItem(useHashRoute().hash);
  return (
    <div className="phead">
      <div className={item ? 'haschip' : undefined}>
        {/* static icon markup from our own icons.js, no user data */}
        {item && <span className="pchip" aria-hidden="true" dangerouslySetInnerHTML={{ __html: iconFor(item.href).replace(/width="18" height="18"/, 'width="20" height="20"') }} />}
        <h1>{title}{audit && <> <AuditButton scope={audit} title={title} /></>}</h1>{subtitle && <div className="sub">{subtitle}</div>}
      </div>
      {actions && <div className="pactions">{actions}</div>}
    </div>
  );
}

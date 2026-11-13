// The side menu. Screens already in React open here; the rest open in the current app (same sign-in).
import { memo, useMemo } from 'react';
import { iconFor } from '../../../public/js/icons.js';
import { LEGACY_BASE } from '../config.js';
import { isMoved } from '../router/routes.js';
import { useSession } from '../session/SessionProvider.jsx';
import { ADMIN_NAV, NAV, SECTION_KEY } from './navConfig.js';

// The menu item for this address: an exact match, else the longest item it starts with (as in the current app)
export function bestItem(hrefs, hash) {
  const path = hash.split('?')[0];
  const fits = (h) => h === hash || (!h.includes('?') && (h === path || (h !== '#/' && path.startsWith(h + '/'))));
  return hrefs.filter(fits).sort((a, b) => (b === hash) - (a === hash) || b.length - a.length)[0] || null;
}

const ALL_HREFS = [...NAV, ...ADMIN_NAV].flatMap((s) => s.items.map(([h]) => h));
const SEC_OF = new Map([...NAV.map((s) => [s, SECTION_KEY[s.head] || 'home']), ...ADMIN_NAV.map((s) => [s, 'admin'])]
  .flatMap(([s, k]) => s.items.map(([h]) => [h, k])));

// The menu item a page belongs to (its icon and section colour): { href, sec } or null
export function activeMenuItem(hash) {
  const href = bestItem(ALL_HREFS, hash);
  return href ? { href, sec: SEC_OF.get(href) } : null;
}

function Section({ sec, isAdmin, canAny, active }) {
  const items = sec.items.filter(([, , codes]) => !codes || canAny(codes));
  if (!items.length) return null;
  const key = isAdmin ? 'admin' : SECTION_KEY[sec.head] || 'home';
  return <>
    {sec.head && <div className="navsub" data-sec={key}>{sec.head}</div>}
    {items.map(([href, label]) => {
      const moved = isMoved(href);
      return (
        <a key={href} href={moved ? href : LEGACY_BASE + href} data-sec={key} className={href === active ? 'on' : undefined}
          title={moved ? undefined : 'Opens in the current app (not yet moved to the new screens)'}>
          {/* static icon markup from our own icons.js, no user data */}
          <span className="nico" dangerouslySetInnerHTML={{ __html: iconFor(href) }} />{label}
        </a>
      );
    })}
  </>;
}

function Nav({ hash }) {
  const { canAny } = useSession(); // a new canAny only when the person or the lab changes
  const active = bestItem(ALL_HREFS, hash);
  const admin = useMemo(() => ADMIN_NAV.some((s) => s.items.some(([, , c]) => !c || canAny(c))), [canAny]);
  return (
    <nav id="nav">
      {NAV.map((s, i) => <Section key={i} sec={s} canAny={canAny} active={active} />)}
      {admin && <div className="navhead">Admin</div>}
      {ADMIN_NAV.map((s) => <Section key={s.head} sec={s} isAdmin canAny={canAny} active={active} />)}
    </nav>
  );
}
export default memo(Nav);

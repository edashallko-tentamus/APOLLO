// The side menu. Screens already in React open here; the rest open in the current app (same sign-in).
import { memo, useMemo } from 'react';
import { Nav as BsNav } from 'react-bootstrap';
import { iconFor } from '../lib/icons.js';
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

function Section({ sec, isAdmin, canAny, active, onPick }) {
  const items = sec.items.filter(([, , codes]) => !codes || canAny(codes));
  if (!items.length) return null;
  const key = isAdmin ? 'admin' : SECTION_KEY[sec.head] || 'home';
  return <>
    {sec.head && <div className="navsub" data-sec={key}>{sec.head}</div>}
    {items.map(([href, label]) => (
      <BsNav.Link key={href} href={href} data-sec={key} active={href === active} onClick={onPick}>
        {/* static icon markup from our own icons.js, no user data */}
        <span className="nico" dangerouslySetInnerHTML={{ __html: iconFor(href) }} />{label}
      </BsNav.Link>
    ))}
  </>;
}

function Nav({ hash, onPick }) {
  const { canAny } = useSession(); // a new canAny only when the person or the lab changes
  const active = bestItem(ALL_HREFS, hash);
  const admin = useMemo(() => ADMIN_NAV.some((s) => s.items.some(([, , c]) => !c || canAny(c))), [canAny]);
  return (
    <BsNav as="nav" id="nav" className="flex-column flex-nowrap">
      {NAV.map((s, i) => <Section key={i} sec={s} canAny={canAny} active={active} onPick={onPick} />)}
      {admin && <div className="navhead">Admin</div>}
      {ADMIN_NAV.map((s) => <Section key={s.head} sec={s} isAdmin canAny={canAny} active={active} onPick={onPick} />)}
    </BsNav>
  );
}
export default memo(Nav);

// Home of the new screens while they are being built: who is signed in, where, and what has moved so far.
// shortcut: the current app's Home is the widget dashboard; it moves here with the dashboard area.
import PageHeader from '../../components/PageHeader.jsx';
import { LEGACY_BASE } from '../../config.js';
import { useSession } from '../../session/SessionProvider.jsx';

export default function HomePage() {
  const { user, site, groups } = useSession();
  return <>
    <PageHeader title={`Welcome, ${user.full_name}`} subtitle={site ? `Working in ${site.site_code} (${site.site_name})` : 'You are not assigned to a lab yet. Ask an administrator.'} />
    <div className="card">
      <p>These are the new screens, being moved over one area at a time. Menu items that have not moved yet open in the current app, with the same sign-in.</p>
      {groups.length > 0 && <p>Your groups here: {groups.join(', ')}.</p>}
      <a className="btn ghost" href={LEGACY_BASE + '#/'}>Open the current app&apos;s Home</a>
    </div>
  </>;
}

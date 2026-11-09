import { memo, useState } from 'react';
import { useSession } from '../session/SessionProvider.jsx';
import Brand from './Brand.jsx';
import ChangePasswordDialog from './ChangePasswordDialog.jsx';
import LabSwitcher from './LabSwitcher.jsx';

function Header() {
  const { productName, user, site, groups, signOut } = useSession();
  const [pwOpen, setPwOpen] = useState(false);
  if (!user) return null; // signed in but missing from the people list: nothing to show yet
  const g = user.is_admin ? ['System administrator', ...groups] : groups;
  const detail = site?.view_only ? ' · view only' : g.length ? ` · ${g.slice(0, 2).join(', ')}${g.length > 2 ? ` +${g.length - 2}` : ''}` : '';

  return (
    <header className="top">
      <Brand productName={productName} />
      <div className="who">
        <LabSwitcher />
        <span id="whoName" className="whoname">{user.full_name}<small title={g.join(', ')}>{user.username}{detail}</small></span>
        <button id="pwBtn" className="btn ghost small" onClick={() => setPwOpen(true)}>Change password</button>
        <button id="outBtn" className="btn ghost small" onClick={signOut}>Sign out</button>
      </div>
      {pwOpen && <ChangePasswordDialog onClose={() => setPwOpen(false)} />}
    </header>
  );
}
export default memo(Header);

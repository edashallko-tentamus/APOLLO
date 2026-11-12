import { memo, useState } from 'react';
import { useSession } from '../session/SessionProvider.jsx';
import Brand from './Brand.jsx';
import ChangePasswordDialog from './ChangePasswordDialog.jsx';
import HeaderSearch from './HeaderSearch.jsx';
import LabSwitcher from './LabSwitcher.jsx';
import { Button } from 'react-bootstrap';

function Header({ onMenu }) {
  const { productName, user, site, groups, signOut } = useSession();
  const [pwOpen, setPwOpen] = useState(false);
  if (!user) return null; // signed in but missing from the people list: nothing to show yet
  const g = user.is_admin ? ['System administrator', ...groups] : groups;
  const detail = site?.view_only ? ' · view only' : g.length ? ` · ${g.slice(0, 2).join(', ')}${g.length > 2 ? ` +${g.length - 2}` : ''}` : '';

  return (
    <header className="top">
      <Button id="menuBtn" variant="outline-light" size="sm" className="d-lg-none" onClick={onMenu}><span aria-hidden="true">☰</span> Menu</Button>
      <Brand productName={productName} />
      <HeaderSearch />
      <div className="who">
        <LabSwitcher />
        <span id="whoName" className="whoname">{user.full_name}<small title={g.join(', ')}>{user.username}{detail}</small></span>
        <Button id="pwBtn" variant="outline-light" size="sm" onClick={() => setPwOpen(true)}>Change password</Button>
        <Button id="outBtn" variant="outline-light" size="sm" onClick={signOut}>Sign out</Button>
      </div>
      {pwOpen && <ChangePasswordDialog onClose={() => setPwOpen(false)} />}
    </header>
  );
}
export default memo(Header);

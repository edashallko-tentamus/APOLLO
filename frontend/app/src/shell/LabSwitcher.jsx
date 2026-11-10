// The lab-prefix button next to the person's name: shows the lab being worked in and switches between their labs
import { useEffect, useRef, useState } from 'react';
import { useToast } from '../components/Toasts.jsx';
import { confirmLeave } from '../router/useHashRoute.js';
import { useSession } from '../session/SessionProvider.jsx';

export default function LabSwitcher() {
  const { site, sites, setSite } = useSession();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (!wrap.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [open]);

  async function choose(s) {
    setOpen(false);
    if (s.id === site?.id || !(await confirmLeave())) return; // switching lab redraws the page: unsaved edits would go
    setSite(s.id); toast(`Now working in ${s.site_code}`);
  }
  function keys(e) {
    const items = [...wrap.current.querySelectorAll('.labmenu button')];
    const i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); if (!open) setOpen(true); (items[Math.min(items.length - 1, i + 1)] || items[0])?.focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); items[Math.max(0, i - 1)]?.focus(); }
    if (e.key === 'Escape') { setOpen(false); wrap.current.querySelector('#labBtn').focus(); }
  }

  return (
    <div className="lab" ref={wrap} onKeyDown={keys}>
      <button id="labBtn" className={`labicon${site ? '' : ' none'}`} aria-haspopup="true" aria-expanded={open}
        title={site ? `Working in ${site.site_code} (${site.site_name}).${sites.length > 1 ? ' Click to switch lab.' : ''}` : 'You are not assigned to a lab. Ask an administrator.'}
        onClick={() => sites.length && setOpen((o) => !o)}>
        {site ? site.site_code : 'No lab'}
      </button>
      <div className={`labmenu${open ? ' show' : ''}`} role="menu">
        {sites.length ? sites.map((s) => (
          <button key={s.id} role="menuitem" className={s.id === site?.id ? 'on' : undefined} onClick={() => choose(s)}><b>{s.site_code}</b> {s.site_name}</button>
        )) : <div className="help">No labs assigned.</div>}
      </div>
    </div>
  );
}

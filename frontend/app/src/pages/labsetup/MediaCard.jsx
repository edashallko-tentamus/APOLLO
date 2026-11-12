// A lab's images (migration 030): logo, small logo, accreditation mark and others. Placeholders until uploaded.
//   <MediaCard site={{ id, site_code }} onChange={() => ...} />  (used by Admin > Sites and holidays)
import { listSiteMedia, retireSiteMedia, siteMediaUrl, uploadSiteMedia } from '../../api/labsetup.js';
import Section from '../../components/Section.jsx';
import { useDialogs } from '../../components/dialogs/DialogProvider.jsx';
import { useToast } from '../../components/Toasts.jsx';
import { useApi } from '../../hooks/useApi.js';
import './labsetup.css';
import { Button, Card } from 'react-bootstrap';

const KINDS = [
  ['Logo', 'Printed at the top of the lab\'s COAs.'],
  ['Small logo', 'Shown in the header beside the lab code while you work in this lab.'],
  ['Accreditation mark', 'Printed beside the accreditation statement on the COA, once the statement is filled in.'],
];

const readBase64 = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = () => rej(new Error('The file could not be read')); r.readAsDataURL(file); });

export default function MediaCard({ site, onChange }) {
  const dialogs = useDialogs();
  const toast = useToast();
  const { data: d, error, reload } = useApi((opts) => listSiteMedia(site.id, opts), [site.id]);
  const done = () => { reload(); onChange?.(); };

  async function upload(kind) {
    let file = null;
    const v = await dialogs.form({ title: `${kind}: ${site.site_code}`, okText: 'Upload', intro: 'Choose the image. It is stored unchanged with its fingerprint; a replaced image is kept in the history.',
      before: <div className="field"><label htmlFor="f_file">Image</label><input type="file" id="f_file" accept="image/png,image/jpeg,image/svg+xml" onChange={(e) => { file = e.target.files[0] || null; }} /></div>,
      fields: kind === 'Other' ? [{ name: 'title', label: 'What it is', required: true }] : [],
      submit: async (vals) => { if (!file) throw new Error('Choose an image file.'); return vals; } });
    if (!v || !file) return;
    const reason = await dialogs.reason(`the ${kind.toLowerCase()} of ${site.site_code}`); if (reason === null) return;
    try {
      await uploadSiteMedia(site.id, { kind, title: v.title || null, file_name: file.name, mime_type: file.type, b64: await readBase64(file), reason });
      // shortcut: the old screen refreshed the header's lab logo here (hooks.refreshLabLogo); the React header shows no lab logo yet
      toast(`${kind} uploaded.`); done();
    } catch (e) { toast(e.message, 'err'); }
  }
  async function retire(id) {
    const reason = await dialogs.reason('removing this image'); if (reason === null) return;
    // shortcut: no header logo refresh (see above)
    try { await retireSiteMedia(id, reason); toast('Image removed.'); done(); } catch (e) { toast(e.message, 'err'); }
  }

  if (error) return <Card body className="err">{error.message}</Card>;
  if (!d) return <Card body><div className="loading">Loading…</div></Card>;
  const cur = (k) => d.rows.find((m) => m.kind === k && m.status === 'Active');
  const others = d.rows.filter((m) => m.kind === 'Other' && m.status === 'Active');
  return (
    <Section title={`Images: ${site.site_code}`} help={`The lab's logo and marks. Until a file is uploaded the slot stays a placeholder and nothing is printed. PNG, JPEG or SVG, up to 2 MB. ${d.can_edit ? '' : 'The lab\'s administrators upload them (admin.lab).'}`}
      actions={d.can_edit && <Button type="button" variant="outline-secondary" onClick={() => upload('Other')}>+ Other image</Button>}>
      <div className="mslots">
        {KINDS.map(([k, what]) => { const m = cur(k); return (
          <div key={k} className={`mslot${m ? ' has' : ''}`} data-kind={k}>
            <h4>{k}</h4><div className="what">{what}</div>
            <div className="pic">{m ? <img src={siteMediaUrl(m.id)} alt={`${k} of ${site.site_code}`} /> : 'No file yet'}</div>
            {m && <div className="what">{m.file_name} · {m.uploaded_by}</div>}
            {d.can_edit && <div className="acts">
              <Button type="button" variant="outline-secondary" size="sm" className="mini" onClick={() => upload(k)}>{m ? 'Replace…' : 'Upload…'}</Button>
              {m && <Button type="button" variant="outline-secondary" size="sm" className="mini" onClick={() => retire(m.id)}>Remove</Button>}
            </div>}
          </div>); })}
        {others.map((m) => (
          <div key={m.id} className="mslot has">
            <h4>{m.title || 'Other image'}</h4>
            <div className="pic"><img src={siteMediaUrl(m.id)} alt={m.title || ''} /></div>
            {d.can_edit && <div className="acts"><Button type="button" variant="outline-secondary" size="sm" className="mini" onClick={() => retire(m.id)}>Remove</Button></div>}
          </div>
        ))}
      </div>
    </Section>
  );
}

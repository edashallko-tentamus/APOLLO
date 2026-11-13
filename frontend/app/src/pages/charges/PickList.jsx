// Tick boxes inside a form dialog (the old modal's `.picklist` html + collect): the ticked values go into `picked` (a Set
// the caller keeps), so dialogs.form({ after: <PickList items picked /> }) needs no change to the shared dialog.
import { Form } from 'react-bootstrap';
export default function PickList({ items, picked, empty }) {
  if (!items.length) return <div className="picklist">{empty}</div>;
  return (
    <div className="picklist">
      {items.map((it) => (
        <label key={it.value} className="cb">
          <Form.Check.Input type="checkbox" defaultChecked={picked.has(it.value)} onChange={(e) => { if (e.target.checked) picked.add(it.value); else picked.delete(it.value); }} />
          {' '}{it.label}{it.small && <> <small>{it.small}</small></>}
        </label>
      ))}
    </div>
  );
}

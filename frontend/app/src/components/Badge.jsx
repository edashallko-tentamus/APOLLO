// A status shown as a coloured pill (react-bootstrap Badge); the colour comes from the kind of state.
import { Badge as BsBadge } from 'react-bootstrap';

const GROUPS = {
  success: 'active accepted effective reported complete approved pass in-service available auto-accepted',
  warning: 'on-hold quoted submitted-for-quote draft client-on-hold calibration-due maintenance-due partly-received short-shipped submitted',
  danger: 'fail not-accepted not-approved out-of-service damaged cancelled suspended',
  info: 'in-testing in-progress in-review awaiting-review awaiting-second-approval pending-approval in-pool batching incubation gmp list-price-acceptance',
  primary: 'ordered logged received open requested new-equipment in-transit',
};
const BG = new Map(Object.entries(GROUPS).flatMap(([bg, keys]) => keys.split(' ').map((k) => [k, bg])));

export default function Badge({ status }) {
  const k = String(status || '').toLowerCase().replace(/[^a-z]+/g, '-');
  const bg = BG.get(k) || 'secondary';
  return <BsBadge pill bg={bg} text={bg === 'warning' || bg === 'info' ? 'dark' : undefined} className={`b-${k}`}>{status}</BsBadge>;
}

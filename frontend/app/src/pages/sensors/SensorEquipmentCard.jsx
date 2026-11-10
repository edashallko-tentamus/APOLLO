// The equipment page's Sensors card: its sensors, the last reading and the last 24 hours.
//   <SensorEquipmentCard equipmentId={id} />  (draws nothing when no sensor feeds the equipment, or the request fails)
import { getEquipmentSensors } from '../../api/sensors.js';
import Section from '../../components/Section.jsx';
import { useApi } from '../../hooks/useApi.js';
import './sensors.css';

const num = (v) => (v === null || v === undefined || v === '' ? '' : String(Number(Number(v).toPrecision(6))));
const UNIT = { temperature: '°C', humidity: '% RH' };

export default function SensorEquipmentCard({ equipmentId }) {
  const { data: d } = useApi((opts) => getEquipmentSensors(equipmentId, opts), [equipmentId]);
  if (!d || !d.rows.length) return null;
  return (
    <Section title="Sensors" help="Readings from Monnit sensors feeding its logbook (Admin > Lab setup > Sensors).">
      <div className="lb-due">{d.rows.map((x, i) => (
        <span key={i} className={x.status === 'Active' ? 'ok' : undefined}>
          {x.external_id}{x.sensor_name ? ' ' + x.sensor_name : ''} ({x.measures}): {x.last
            ? <>{num(x.last.value)} {x.unit || UNIT[x.measures]} at {new Date(x.last.at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
              {x.day && x.day.n ? `; last 24 h ${num(x.day.lo)} to ${num(x.day.hi)}` : ''}
              {x.last.battery !== null && x.last.battery < 20 ? `; battery ${x.last.battery} %` : ''}</>
            : 'no reading yet'}
          {x.status === 'Awaiting QA' ? ' (awaiting QA)' : ''} · <a href={'#/logbooks/' + x.logbook_id}>{x.logbook_code}</a>
        </span>
      ))}</div>
    </Section>
  );
}

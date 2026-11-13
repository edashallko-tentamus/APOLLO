// The workflow diagram, drawn from the steps and their connections: one row per layer (a step sits under the steps it
// follows), parallel branches dashed green. Click (or Enter) on a step to open it.
import { TYPE_COLOR } from './shared.jsx';

const W = 180; const H = 50; const GX = 22; const GY = 34;

export function layout(steps, deps) {
  const byId = new Map(steps.map((s) => [s.id, s]));
  const parents = new Map(steps.map((s) => [s.id, []]));
  deps.forEach((x) => { if (parents.has(x.step_id) && byId.has(x.depends_on_step_id)) parents.get(x.step_id).push(x.depends_on_step_id); });
  const layer = new Map(); const visiting = new Set();
  const depth = (id) => {
    if (layer.has(id)) return layer.get(id); if (visiting.has(id)) return 0; visiting.add(id);
    const p = parents.get(id) || []; const l = p.length ? Math.max(...p.map(depth)) + 1 : 0; layer.set(id, l); return l;
  };
  steps.forEach((s) => depth(s.id));
  const layers = []; steps.forEach((s) => { const l = layer.get(s.id); (layers[l] = layers[l] || []).push(s); });
  // top to bottom: one row per layer, a layer's steps side by side (ordered under their parents), rows centred
  const pos = new Map();
  const maxN = Math.max(1, ...layers.map((l) => (l ? l.length : 0)));
  const width = 32 + maxN * (W + GX); const height = 32 + layers.length * (H + GY);
  const avgX = (s) => { const p = parents.get(s.id) || []; return p.length ? p.reduce((a, id) => a + (pos.get(id)?.x || 0), 0) / p.length : 0; };
  layers.forEach((ls, li) => {
    if (!ls) return;
    if (li > 0) ls.sort((a, b) => avgX(a) - avgX(b) || a.sort_order - b.sort_order); else ls.sort((a, b) => a.sort_order - b.sort_order);
    const off = (width - ls.length * (W + GX) + GX) / 2;
    ls.forEach((s, i) => pos.set(s.id, { x: off + i * (W + GX), y: 16 + li * (H + GY) }));
  });
  return { pos, width, height };
}

export default function WorkflowDiagram({ steps, deps, selId, badKeys, onOpen }) {
  const { pos, width, height } = layout(steps, deps);
  return (
    <svg width={width} height={height} xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Workflow diagram">
      <defs>
        <marker id="arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#8A96A3" /></marker>
        <marker id="arrp" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#006241" /></marker>
      </defs>
      {deps.map((x, i) => {
        const a = pos.get(x.depends_on_step_id); const b = pos.get(x.step_id); if (!a || !b) return null;
        const x1 = a.x + W / 2; const y1 = a.y + H; const x2 = b.x + W / 2; const y2 = b.y; const my = (y1 + y2) / 2;
        const par = x.dependency_type === 'Parallel';
        return <path key={i} className={`e ${par ? 'par' : ''}`} d={`M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2 - 5}`} markerEnd={`url(#arr${par ? 'p' : ''})`} />;
      })}
      {steps.map((s) => {
        const p = pos.get(s.id); const nm = s.step_name.length > 25 ? s.step_name.slice(0, 24) + '…' : s.step_name;
        return (
          <g key={s.id} className={`node ${s.id === selId ? 'sel' : ''} ${badKeys.has(s.step_key) ? 'bad' : ''}`} data-step={s.id} transform={`translate(${p.x},${p.y})`}
            tabIndex={0} role="button" aria-label={s.step_name} onClick={() => onOpen(s.id)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(s.id); } }}>
            <rect width={W} height={H} rx="8" fill={TYPE_COLOR[s.step_type] || '#fff'} />
            <text x="10" y="21">{nm}</text>
            <text className="t" x="10" y="39">{s.step_type} · {s.step_key}</text>
          </g>
        );
      })}
    </svg>
  );
}

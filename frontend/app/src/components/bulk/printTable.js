// Print a simple table of rows through the browser: printTable(title, [{ title, get(row) }], rows)
import './bulk.css';

export function printTable(title, columns, rows) {
  const host = document.createElement('div'); host.id = 'printarea';
  const el = (tag, text, cls) => { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (cls) e.className = cls; return e; };
  host.append(el('h2', title), el('p', `${new Date().toLocaleString()} · ${rows.length} row${rows.length === 1 ? '' : 's'}`, 'help'));
  const table = el('table', undefined, 'qt'); const hr = el('tr');
  columns.forEach((c) => hr.append(el('th', c.title)));
  table.append(el('thead')); table.tHead.append(hr);
  const body = el('tbody');
  rows.forEach((r) => { const tr = el('tr'); columns.forEach((c) => tr.append(el('td', String(c.get(r) ?? '')))); body.append(tr); });
  table.append(body); host.append(table);
  document.body.appendChild(host); document.body.classList.add('printing-list');
  const cleanup = () => { document.body.classList.remove('printing-list'); host.remove(); window.removeEventListener('afterprint', cleanup); };
  window.addEventListener('afterprint', cleanup);
  setTimeout(() => { try { window.print(); } catch { /* printing blocked */ } setTimeout(cleanup, 1000); }, 50);
}

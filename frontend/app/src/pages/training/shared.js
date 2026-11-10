// What the training screens share: dates, the state colours, reading files, the competency columns.
export const d8 = (v) => (v ? new Date(v).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '');
export const stateCls = (s) => (s === 'Lapsed' ? 'cbad' : s === 'Due soon' ? 'cwarn' : s === 'Withdrawn' ? 'mutedcell' : '');
const readB64 = (file) => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).replace(/^data:[^,]*,/, '')); fr.onerror = rej; fr.readAsDataURL(file); });
// files as the backend takes them: [{ file_name, mime_type, base64, title }]
export const documentsOf = async (files) => {
  const documents = [];
  for (const f of files) documents.push({ file_name: f.name, mime_type: f.type || 'application/octet-stream', base64: await readB64(f), title: f.name });
  return documents;
};

export function attemptCols(withPerson) {
  return [
    { field: 'attempt_code', title: 'Attempt', type: 'link', width: 100, href: (r) => '#/training/attempts/' + r.id },
    ...(withPerson ? [{ field: 'full_name', title: 'Person', type: 'link', width: 170, href: (r) => '#/training/people/' + r.user_id }] : []),
    { field: 'test_name', title: 'Test', type: 'readonly', width: 220 },
    { field: 'kind', title: 'Kind', type: 'readonly', width: 95 },
    { field: 'route', title: 'How', type: 'readonly', width: 125 },
    { field: 'status', title: 'Status', type: 'readonly', width: 110, cellClass: (r) => (r.status === 'Evaluated' ? 'cwarn' : '') },
    { field: 'evaluation', title: 'Evaluation', type: 'readonly', width: 120 },
    { field: 'evaluated_by_name', title: 'Evaluated by', type: 'readonly', width: 140 },
    { field: 'decided_by_name', title: 'QA', type: 'readonly', width: 140 },
    { field: 'created_at', title: 'Started', type: 'readonly', width: 110, format: d8 },
  ];
}
export const ATTEMPT_COLS_PERSON = attemptCols(true);
export const ATTEMPT_COLS = attemptCols(false);

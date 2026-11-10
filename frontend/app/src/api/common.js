// Lists and records every area uses: the enum lists, the audit trail
import { get } from './client.js';

// { enums: { analyte_class: [...], ... }, ... }: the controlled lists the screens offer
export const getMeta = () => get('/meta');

// Audit trail of a page: { kind, id } for a record and its parts, { kind } for the records of a list page (latest 500)
export const auditScope = ({ kind, id }) => get(`/audit/scope?kind=${encodeURIComponent(kind)}${id ? '&id=' + encodeURIComponent(id) : ''}`, { fresh: true });

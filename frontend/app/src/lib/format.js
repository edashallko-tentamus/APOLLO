// Display formats shared by every screen (the grid uses the same money and percent formats)
import { fmt } from '../components/grid/gridModel.js';

export const money = fmt.money;
export const pct = fmt.pct;
const has = (v) => v !== null && v !== undefined && v !== '';
export const dateTime = (v) => (has(v) ? new Date(v).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : '');
export const dateOnly = (v) => (has(v) ? String(v).slice(0, 10) : '');
export const plural = (n, word, many = word + 's') => `${n} ${n === 1 ? word : many}`;

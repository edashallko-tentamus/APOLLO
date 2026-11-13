// Barcode labels (backend: labels module): the records to print labels for, with what each label shows
import { get } from './client.js';

// kind: sample | lot | equipment | batch
export const getLabels = (kind, ids) => get(`/labels/${kind}?ids=${ids.map(encodeURIComponent).join(',')}`, { fresh: true });

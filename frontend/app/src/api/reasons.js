// Canned reasons for change, per module (Admin > Canned reasons), offered in the Reason dialog
import { get } from './client.js';

export const cannedReasons = (module) => get('/reasons?module=' + encodeURIComponent(module));

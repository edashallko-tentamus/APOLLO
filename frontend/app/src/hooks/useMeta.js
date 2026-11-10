// The controlled lists (enums) from /api/meta, loaded once and shared: const meta = useMeta(); meta?.enums.analyte_class
import { getMeta } from '../api/common.js';
import { useApi } from './useApi.js';

export function useMeta() {
  return useApi(getMeta, []).data;
}

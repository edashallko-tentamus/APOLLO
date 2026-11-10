// Adding rows with given values to a useGrid grid from a button (e.g. "+ Add tests" after a pick dialog).
//   const q = useRowQueue(() => defaults); const grid = useGrid({ ..., allowAdd: true, newRow: q.newRow }); q.useClear(grid);
//   q.add(grid, [{...}, {...}]);
// The shared grid now adds given rows itself (grid.act.addRows(rows)); this keeps the two editors' calls unchanged.
import { useCallback, useRef } from 'react';

export function useRowQueue(fallback) {
  const fb = useRef(fallback); fb.current = fallback;
  const newRow = useCallback(() => fb.current(), []);
  const add = useCallback((grid, rows) => { if (rows.length) grid.act.addRows(rows); }, []);
  const useClear = () => {}; // nothing queued any more
  return { newRow, add, useClear };
}

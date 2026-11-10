// A read-only grid for rows that come and go (loaded, reloaded): selection, copy to Excel, search, sort, links.
//   <ReadGrid rows={data?.rows} columns={COLUMNS} search onRowOpen={…} apiRef={ref} />
// apiRef gets { selectedRows(), grid } (e.g. "Claim selected"). Pass columns from module level or useMemo, so rows are
// not redrawn for nothing.
import { useEffect, useImperativeHandle } from 'react';
import DataGrid from './DataGrid.jsx';
import { useGrid } from './useGrid.js';

const NONE = [];

export default function ReadGrid({ rows, columns, keyField, filter, apiRef, ...gridProps }) {
  const list = rows || NONE;
  const grid = useGrid({ rows: list, columns, keyField, readOnly: true, filter });
  const { reset } = grid;
  useEffect(() => { reset(list); }, [list, reset]);
  useImperativeHandle(apiRef, () => ({ grid, selectedRows: grid.selectedRows }), [grid]);
  return <DataGrid grid={grid} {...gridProps} />;
}

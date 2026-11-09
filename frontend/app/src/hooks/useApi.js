// Load data for a screen: { data, error, loading, reload }. An answer that arrives after the inputs changed (or after
// the screen closed) is dropped, so a slow request never overwrites a newer one.
import { useCallback, useEffect, useRef, useState } from 'react';

export function useApi(load, deps) {
  const [state, setState] = useState({ data: undefined, error: null, loading: true });
  const run = useRef(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the caller lists what `load` depends on
  const fetchIt = useCallback(load, deps);

  const start = useCallback((opts) => {
    const id = ++run.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    fetchIt(opts).then(
      (data) => { if (id === run.current) setState({ data, error: null, loading: false }); },
      (error) => { if (id === run.current) setState((s) => ({ data: s.data, error, loading: false })); },
    );
  }, [fetchIt]);

  useEffect(() => { start(); return () => { run.current++; }; }, [start]);

  const reload = useCallback(() => start({ fresh: true }), [start]);
  return { ...state, reload };
}

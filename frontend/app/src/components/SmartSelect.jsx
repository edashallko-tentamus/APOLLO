// The smart dropdown for every pick list (the current app's combo.js): type to filter to the closest match,
// Down arrow opens the list, arrows and Enter or Tab pick, Escape closes. options: [{ value, label }].
import { useEffect, useRef } from 'react';
import { Combo, rankOptions } from '../../../public/js/combo.js';

export default function SmartSelect({ id, value, options, onChange, className = '', ...rest }) {
  const input = useRef(null);
  const combo = useRef(null);
  const latest = useRef({ options, value, onChange });
  latest.current = { options, value, onChange };
  const labelOf = (v) => options.find((o) => String(o.value) === String(v ?? ''))?.label ?? '';

  // the box shows the chosen option's label whenever the value changes from outside
  useEffect(() => { if (input.current && document.activeElement !== input.current) input.current.value = labelOf(value); });

  useEffect(() => {
    const pick = (o) => { if (o) latest.current.onChange(o.value); input.current.value = o ? o.label : ''; };
    combo.current = new Combo(input.current, { options: () => latest.current.options, current: () => latest.current.value, onPick: pick });
    return () => combo.current.close();
  }, []);

  function keyDown(e) {
    const c = combo.current;
    if (e.key === 'Tab' && c.highlighted()) { latest.current.onChange(c.highlighted().value); c.close(); return; }
    if (c.key(e)) e.stopPropagation();
  }
  // leaving the box takes the closest match to what was typed (blank: the blank option, if there is one)
  function blur() {
    setTimeout(() => {
      const el = input.current; if (!el || document.activeElement === el) return;
      const typed = el.value.trim();
      if (typed === labelOf(latest.current.value).trim()) return;
      const best = typed ? rankOptions(latest.current.options, typed)[0] : latest.current.options.find((o) => o.value === '');
      if (best) latest.current.onChange(best.value);
      el.value = labelOf(best ? best.value : latest.current.value);
    }, 150);
  }

  return (
    <span className="combo">
      <input ref={input} id={id} type="text" className={`combo-input ${className}`.trim()} onKeyDown={keyDown} onBlur={blur}
        onFocus={(e) => e.target.select()} onMouseUp={(e) => { e.preventDefault(); if (!combo.current.isOpen) combo.current.open(''); }} {...rest} />
    </span>
  );
}

import { ENV_LABEL } from '../config.js';

// Two letters from the product name: its first and last capitals, else its first two letters
export function initials(name) {
  const c = name.replace(/[^A-Za-z0-9]/g, ''); const caps = c.replace(/[^A-Z0-9]/g, '');
  return (caps.length >= 2 ? caps[0] + caps[caps.length - 1] : c.slice(0, 2)).toUpperCase() || 'L';
}

export default function Brand({ productName }) {
  return (
    <div className="brand">
      <span className="logo">{initials(productName)}</span>
      <div><b>{productName}</b><small>{ENV_LABEL}</small></div>
    </div>
  );
}

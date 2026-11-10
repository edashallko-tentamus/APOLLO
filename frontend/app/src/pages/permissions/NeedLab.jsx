// The permission pages need a lab and one of their permissions there
import { useSession } from '../../session/SessionProvider.jsx';

export const CODES = ['admin.groups', 'admin.users', 'audit.view'];

export default function NeedLab({ children }) {
  const { site, canAny } = useSession();
  if (!site) return <div className="card err">Choose your lab (top right) first.</div>;
  if (!canAny(CODES)) return <div className="card err">You need one of these permissions in this lab to open this page: {CODES.join(', ')}.</div>;
  return children;
}

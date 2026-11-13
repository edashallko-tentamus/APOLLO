// The permission pages need a lab and one of their permissions there
import { useSession } from '../../session/SessionProvider.jsx';
import { Card } from 'react-bootstrap';

export const CODES = ['admin.groups', 'admin.users', 'audit.view'];

export default function NeedLab({ children }) {
  const { site, canAny } = useSession();
  if (!site) return <Card body className="err">Choose your lab (top right) first.</Card>;
  if (!canAny(CODES)) return <Card body className="err">You need one of these permissions in this lab to open this page: {CODES.join(', ')}.</Card>;
  return children;
}

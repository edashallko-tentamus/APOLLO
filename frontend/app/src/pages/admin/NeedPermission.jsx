
import { Card } from 'react-bootstrap';// Shown instead of an Admin page when the person lacks its permission in this lab
export default function NeedPermission({ code, text }) {
  return <Card body className="err">{text || `You need the ${code} permission in this lab to open this page. Ask your lab administrator.`}</Card>;
}

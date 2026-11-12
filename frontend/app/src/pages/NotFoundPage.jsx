// An address no screen answers (a mistyped or out-of-date link)
import PageHeader from '../components/PageHeader.jsx';
import { Button, Card } from 'react-bootstrap';

export default function NotFoundPage() {
  return <>
    <PageHeader title="Page not found" subtitle="No screen has this address. It may be mistyped, or the link may be out of date." />
    <Card body><Button variant="primary" href="#/">Go to Home</Button></Card>
  </>;
}

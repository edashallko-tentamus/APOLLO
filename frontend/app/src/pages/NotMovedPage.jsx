// An address whose screen is still in the current app
import PageHeader from '../components/PageHeader.jsx';
import { LEGACY_BASE } from '../config.js';
import { Button, Card } from 'react-bootstrap';

export default function NotMovedPage({ hash }) {
  return <>
    <PageHeader title="Not moved yet" subtitle="This screen has not been moved to the new screens yet." />
    <Card body>
      <p>It still works in the current app, with the same sign-in.</p>
      <Button variant="primary" href={LEGACY_BASE + hash}>Open it in the current app</Button>
    </Card>
  </>;
}

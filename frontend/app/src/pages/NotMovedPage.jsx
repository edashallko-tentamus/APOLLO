// An address whose screen is still in the current app
import PageHeader from '../components/PageHeader.jsx';
import { LEGACY_BASE } from '../config.js';

export default function NotMovedPage({ hash }) {
  return <>
    <PageHeader title="Not moved yet" subtitle="This screen has not been moved to the new screens yet." />
    <div className="card">
      <p>It still works in the current app, with the same sign-in.</p>
      <a className="btn primary" href={LEGACY_BASE + hash}>Open it in the current app</a>
    </div>
  </>;
}

// An address no screen answers (a mistyped or out-of-date link)
import PageHeader from '../components/PageHeader.jsx';

export default function NotFoundPage() {
  return <>
    <PageHeader title="Page not found" subtitle="No screen has this address. It may be mistyped, or the link may be out of date." />
    <div className="card"><a className="btn primary" href="#/">Go to Home</a></div>
  </>;
}

// A page that fails shows its message in place, and the menu and header keep working.
import { Component } from 'react';
import { Button, Card } from 'react-bootstrap';

// A screen's code file from an older build is gone once a newer build is served: reloading picks up the new one
const STALE_BUILD = /dynamically imported module|Importing a module script failed|error loading dynamically/i;

export default class ErrorBoundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error(error, info.componentStack); }
  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (STALE_BUILD.test(error.message || '')) {
      return <Card body>The screens were updated since this page was opened.{' '}
        <Button type="button" variant="primary" onClick={() => window.location.reload()}>Reload</Button></Card>;
    }
    return <Card body className="err">{error.message || 'This page could not be shown.'}</Card>;
  }
}

// Asks before leaving a page (or switching lab, or signing out) with unsaved changes
import { useEffect, useState } from 'react';
import Modal from '../components/Modal.jsx';
import { setLeaveAsker } from '../router/useHashRoute.js';

export default function LeaveConfirm() {
  const [pending, setPending] = useState(null); // the answer to give: resolve(true | false)
  useEffect(() => setLeaveAsker(() => new Promise((resolve) => setPending(() => resolve))), []);
  if (!pending) return null;
  const answer = (v) => { setPending(null); pending(v); };
  return (
    <Modal title="Unsaved changes" intro="You have changes on this page that are not saved. Leave without saving them?"
      okText="Leave without saving" onOk={() => answer(true)} onClose={() => answer(false)} />
  );
}

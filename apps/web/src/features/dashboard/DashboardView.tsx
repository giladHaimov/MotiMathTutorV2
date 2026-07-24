import { useEffect, useState } from 'react';
import type { Dashboard } from '@app/contracts';
import { api } from '../../lib/api/client.js';

export function DashboardView({
  onOpenSession,
}: {
  onOpenSession: (sessionId: string) => void;
}): React.JSX.Element {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api.dashboard().then(setDashboard);
  }, []);

  async function start(): Promise<void> {
    setBusy(true);
    try {
      const session = await api.startSession();
      onOpenSession(session.session_id);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" data-testid="dashboard">
      <h1>Dashboard</h1>
      {dashboard?.active_session ? (
        <button
          type="button"
          data-testid="resume-session"
          onClick={() => onOpenSession(dashboard.active_session!.session_id)}
        >
          Resume session
        </button>
      ) : (
        <p>No active session.</p>
      )}
      <button type="button" data-testid="start-session" onClick={start} disabled={busy}>
        {dashboard?.active_session ? 'Continue' : 'Start learning'}
      </button>
    </div>
  );
}

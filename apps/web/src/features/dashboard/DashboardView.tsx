import { useEffect, useState } from 'react';
import type { Dashboard } from '@app/contracts';
import { api, ApiRequestError, NetworkError } from '../../lib/api/client.js';

export function DashboardView({
  onOpenSession,
}: {
  onOpenSession: (sessionId: string) => Promise<void> | void;
}): React.JSX.Element {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const data = await api.dashboard();
      setDashboard(data);
    } catch (err) {
      if (err instanceof NetworkError) {
        setError('Network error loading dashboard. Check connection and retry.');
      } else if (err instanceof ApiRequestError) {
        setError(err.body.message);
      } else {
        setError('Failed to load dashboard.');
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function start(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const session = await api.startSession();
      await onOpenSession(session.session_id);
    } catch (err) {
      if (err instanceof NetworkError) {
        setError('Network error starting session. Please retry.');
      } else if (err instanceof ApiRequestError) {
        setError(err.body.message);
      } else {
        setError('Failed to start session.');
      }
    } finally {
      setBusy(false);
    }
  }

  async function resume(sessionId: string): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await onOpenSession(sessionId);
    } catch (err) {
      if (err instanceof NetworkError) {
        setError('Network error resuming session. Please retry.');
      } else if (err instanceof ApiRequestError) {
        setError(err.body.message);
      } else {
        setError('Failed to resume session.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" data-testid="dashboard">
      <h1>Dashboard</h1>
      {loading && (
        <p data-testid="dashboard-loading" role="status">
          Loading dashboard…
        </p>
      )}
      {!loading && dashboard?.active_session && (
        <button
          type="button"
          data-testid="resume-session"
          disabled={busy}
          onClick={() => void resume(dashboard.active_session!.session_id)}
        >
          Resume session
        </button>
      )}
      {!loading && !dashboard?.active_session && !error && (
        <p data-testid="dashboard-empty">No active session.</p>
      )}
      {!loading && (
        <button
          type="button"
          data-testid="start-session"
          onClick={() => void start()}
          disabled={busy}
        >
          {dashboard?.active_session ? 'Continue' : 'Start learning'}
        </button>
      )}
      {error && (
        <p className="error" data-testid="dashboard-error" role="alert">
          {error}{' '}
          <button type="button" data-testid="dashboard-retry" onClick={() => void load()}>
            Retry
          </button>
        </p>
      )}
    </div>
  );
}

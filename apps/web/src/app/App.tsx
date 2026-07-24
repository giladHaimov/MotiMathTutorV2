import { useCallback, useEffect, useState } from 'react';
import type { ActionPayload, ActionType, PublicSession, Slot } from '@app/contracts';
import { api, ApiRequestError, newClientActionId } from '../lib/api/client.js';
import { AuthView } from '../features/auth/AuthView.js';
import { DashboardView } from '../features/dashboard/DashboardView.js';
import { ProblemView } from '../features/problem/ProblemView.js';

type AuthState = 'loading' | 'anon' | 'authed';

export function App(): React.JSX.Element {
  const [auth, setAuth] = useState<AuthState>('loading');
  const [session, setSession] = useState<PublicSession | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  const refreshAuth = useCallback(async () => {
    try {
      await api.me();
      setAuth('authed');
    } catch {
      setAuth('anon');
    }
  }, []);

  useEffect(() => {
    void refreshAuth();
  }, [refreshAuth]);

  async function openSession(sessionId: string): Promise<void> {
    const s = await api.getSession(sessionId);
    setSession(s);
    setBanner(s.message);
  }

  // Submit a structured action. Semantic validity is decided only by the server
  // (PB-039 / AC-050). Conflict responses replace local state with authoritative
  // current_state.
  async function submit(actionType: ActionType, payload: ActionPayload): Promise<void> {
    if (!session) return;
    setBanner(null);
    try {
      const updated = await api.submitAction(session.session_id, {
        client_action_id: newClientActionId(),
        expected_state_version: session.state_version,
        action_type: actionType,
        payload,
      });
      setSession(updated);
      if (updated.message) setBanner(updated.message);
    } catch (err) {
      if (err instanceof ApiRequestError && err.currentState) {
        setSession(err.currentState);
        setBanner(err.body.message);
      } else if (err instanceof ApiRequestError) {
        setBanner(err.body.message);
      } else {
        setBanner('Network error. Please retry.');
      }
    }
  }

  async function logout(): Promise<void> {
    await api.signOut();
    setSession(null);
    setAuth('anon');
  }

  if (auth === 'loading') {
    return <div className="container">Loading…</div>;
  }

  return (
    <div className="container">
      {auth === 'authed' && (
        <button type="button" data-testid="logout" onClick={logout}>
          Log out
        </button>
      )}

      {auth === 'anon' && <AuthView onAuthenticated={refreshAuth} />}

      {auth === 'authed' && !session && <DashboardView onOpenSession={openSession} />}

      {auth === 'authed' && session && (
        <ProblemView
          session={session}
          banner={banner}
          onAssign={(slot: Slot, tokenId: string) =>
            void submit('ASSIGN_SLOT', { slot, token_id: tokenId })
          }
          onDelete={(slot: Slot) => void submit('DELETE_ASSIGNMENT', { slot })}
          onContinue={() => void submit('SUBMIT_COMMITMENT', {})}
          onAcknowledge={() => void submit('ACKNOWLEDGE_INSUFFICIENT_INFORMATION', {})}
          onSubmitAnswer={(value: string) => void submit('SUBMIT_FINAL_ANSWER', { value })}
          onReload={() => void openSession(session.session_id)}
          onBack={() => {
            setSession(null);
            setBanner(null);
          }}
        />
      )}
    </div>
  );
}

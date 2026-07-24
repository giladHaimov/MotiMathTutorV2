import { useCallback, useEffect, useRef, useState } from 'react';
import type { ActionPayload, ActionType, PublicSession, Slot } from '@app/contracts';
import {
  api,
  ApiRequestError,
  initApiClient,
  NetworkError,
  newClientActionId,
} from '../lib/api/client.js';
import {
  createPendingAction,
  shouldRetainPendingForRetry,
  type PendingAction,
} from '../lib/api/pending-action.js';
import { subscribeAppResume, subscribeOnlineStatus } from '../lib/platform.js';
import { AuthView } from '../features/auth/AuthView.js';
import { DashboardView } from '../features/dashboard/DashboardView.js';
import { ProblemView } from '../features/problem/ProblemView.js';

type AuthState = 'loading' | 'anon' | 'authed';
type UxMode = 'idle' | 'submitting' | 'conflict' | 'retry' | 'offline' | 'fatal';

export function App(): React.JSX.Element {
  const [auth, setAuth] = useState<AuthState>('loading');
  const [session, setSession] = useState<PublicSession | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [ux, setUx] = useState<UxMode>('idle');
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  const sessionRef = useRef<PublicSession | null>(null);
  sessionRef.current = session;

  const refreshAuth = useCallback(async () => {
    try {
      await initApiClient();
      await api.me();
      setAuth('authed');
    } catch {
      setAuth('anon');
      setSession(null);
    }
  }, []);

  useEffect(() => {
    void refreshAuth();
  }, [refreshAuth]);

  useEffect(() => subscribeOnlineStatus(setOnline), []);

  const openSession = useCallback(async (sessionId: string): Promise<void> => {
    const s = await api.getSession(sessionId);
    setSession(s);
    setBanner(s.message);
    setPending(null);
    setUx('idle');
  }, []);

  // App lifecycle / tab resume: reload authoritative server state (AC-049).
  useEffect(() => {
    if (auth !== 'authed') return;
    return subscribeAppResume(() => {
      const current = sessionRef.current;
      if (!current) return;
      void api
        .getSession(current.session_id)
        .then((s) => {
          setSession(s);
          if (s.message) setBanner(s.message);
        })
        .catch(() => {
          // Keep local presentation; next user action will reconcile.
        });
    });
  }, [auth]);

  useEffect(() => {
    if (!online && pending) {
      setUx('offline');
      setBanner('You appear offline. Reconnect, then tap Retry.');
    }
  }, [online, pending]);

  /**
   * Submit a structured action. Semantic validity is decided only by the server
   * (PB-039 / AC-050). Network loss retains `client_action_id` for Retry (AC-048).
   * Conflict responses replace local state with authoritative `current_state`.
   */
  async function sendAction(action: PendingAction): Promise<void> {
    const current = sessionRef.current;
    if (!current) return;
    setUx('submitting');
    setBanner(null);
    setPending(action);
    try {
      const updated = await api.submitAction(current.session_id, action);
      setSession(updated);
      setPending(null);
      setUx('idle');
      if (updated.message) setBanner(updated.message);
    } catch (err) {
      if (err instanceof ApiRequestError && err.currentState) {
        setSession(err.currentState);
        setPending(null);
        setUx('conflict');
        setBanner(err.body.message);
        return;
      }
      if (err instanceof ApiRequestError) {
        if (shouldRetainPendingForRetry(err.status)) {
          setUx(online ? 'retry' : 'offline');
          setBanner('Server error. Tap Retry to resend the same action.');
          return;
        }
        setPending(null);
        setUx('fatal');
        setBanner(err.body.message);
        return;
      }
      if (err instanceof NetworkError || err instanceof TypeError) {
        setUx(online ? 'retry' : 'offline');
        setBanner('Network error. Tap Retry to resend the same action.');
        return;
      }
      setPending(null);
      setUx('fatal');
      setBanner('Unexpected error. Reload from server.');
    }
  }

  async function submit(actionType: ActionType, payload: ActionPayload): Promise<void> {
    if (!session || pending || ux === 'submitting') return;
    const action = createPendingAction(
      actionType,
      payload,
      session.state_version,
      newClientActionId(),
    );
    await sendAction(action);
  }

  async function retryPending(): Promise<void> {
    if (!pending || ux === 'submitting') return;
    await sendAction(pending);
  }

  async function logout(): Promise<void> {
    await api.signOut();
    setSession(null);
    setPending(null);
    setBanner(null);
    setUx('idle');
    setAuth('anon');
  }

  if (auth === 'loading') {
    return (
      <div className="container" data-testid="boot-loading">
        Loading…
      </div>
    );
  }

  return (
    <div className="container">
      {!online && (
        <p className="offline-banner" data-testid="offline-banner" role="status">
          Offline — reconnect to continue learning.
        </p>
      )}

      {auth === 'authed' && (
        <button type="button" data-testid="logout" onClick={() => void logout()}>
          Log out
        </button>
      )}

      {auth === 'anon' && <AuthView onAuthenticated={() => void refreshAuth()} />}

      {auth === 'authed' && !session && <DashboardView onOpenSession={openSession} />}

      {auth === 'authed' && session && (
        <ProblemView
          session={session}
          banner={banner}
          ux={ux}
          pending={pending !== null}
          submitting={ux === 'submitting'}
          onAssign={(slot: Slot, tokenId: string) =>
            void submit('ASSIGN_SLOT', { slot, token_id: tokenId })
          }
          onDelete={(slot: Slot) => void submit('DELETE_ASSIGNMENT', { slot })}
          onContinue={() => void submit('SUBMIT_COMMITMENT', {})}
          onAcknowledge={() => void submit('ACKNOWLEDGE_INSUFFICIENT_INFORMATION', {})}
          onSubmitAnswer={(value: string) => void submit('SUBMIT_FINAL_ANSWER', { value })}
          onRetry={() => void retryPending()}
          onReload={() => void openSession(session.session_id)}
          onBack={() => {
            setSession(null);
            setPending(null);
            setBanner(null);
            setUx('idle');
          }}
        />
      )}
    </div>
  );
}

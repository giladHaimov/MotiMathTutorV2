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
  clearPendingAction,
  createPendingAction,
  loadPendingAction,
  savePendingAction,
  shouldClearPendingOnAuthFailure,
  shouldRetainPendingForRetry,
  type PendingAction,
} from '../lib/api/pending-action.js';
import { subscribeAppResume, subscribeOnlineStatus } from '../lib/platform.js';
import { AuthView } from '../features/auth/AuthView.js';
import { DashboardView } from '../features/dashboard/DashboardView.js';
import { ProblemView } from '../features/problem/ProblemView.js';

type AuthState = 'loading' | 'anon' | 'authed';
type UxMode = 'idle' | 'submitting' | 'conflict' | 'retry' | 'offline' | 'fatal';

function retainPending(action: PendingAction): void {
  savePendingAction(action);
}

function dropPending(): void {
  clearPendingAction();
}

export function App(): React.JSX.Element {
  const [auth, setAuth] = useState<AuthState>('loading');
  const [session, setSession] = useState<PublicSession | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [ux, setUx] = useState<UxMode>('idle');
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  const sessionRef = useRef<PublicSession | null>(null);
  sessionRef.current = session;

  const applyRestoredPending = useCallback((sessionId: string): PendingAction | null => {
    const stored = loadPendingAction();
    if (stored && stored.session_id === sessionId) {
      setPending(stored);
      setUx('retry');
      setBanner('Unsent action found. Tap Retry to resend the same action.');
      return stored;
    }
    if (stored && stored.session_id !== sessionId) {
      clearPendingAction();
    }
    setPending(null);
    setUx('idle');
    return null;
  }, []);

  const refreshAuth = useCallback(async () => {
    try {
      await initApiClient();
      await api.me();
      setAuth('authed');
    } catch (err) {
      setAuth('anon');
      setSession(null);
      // Durability: only clear pending on definitive 401, never on network/5xx.
      const status = err instanceof ApiRequestError ? err.status : null;
      if (shouldClearPendingOnAuthFailure(status)) {
        dropPending();
        setPending(null);
      }
    }
  }, []);

  useEffect(() => {
    void refreshAuth();
  }, [refreshAuth]);

  useEffect(() => subscribeOnlineStatus(setOnline), []);

  const openSession = useCallback(
    async (sessionId: string): Promise<void> => {
      const s = await api.getSession(sessionId);
      setSession(s);
      const restored = applyRestoredPending(sessionId);
      if (!restored) {
        setBanner(s.message);
      }
    },
    [applyRestoredPending],
  );

  // App lifecycle / tab resume: reload authoritative server state (AC-049),
  // then re-attach any persisted pending action for exactly-once retry.
  useEffect(() => {
    if (auth !== 'authed') return;
    return subscribeAppResume(() => {
      const current = sessionRef.current;
      if (!current) return;
      void api
        .getSession(current.session_id)
        .then((s) => {
          setSession(s);
          const restored = applyRestoredPending(s.session_id);
          if (!restored && s.message) setBanner(s.message);
        })
        .catch(() => {
          // Keep local presentation; next user action will reconcile.
        });
    });
  }, [auth, applyRestoredPending]);

  useEffect(() => {
    if (!online && pending) {
      setUx('offline');
      setBanner('You appear offline. Reconnect, then tap Retry.');
    }
  }, [online, pending]);

  /**
   * Submit a structured action. Semantic validity is decided only by the server
   * (PB-039 / AC-050). Network loss persists `client_action_id` for Retry (AC-048).
   * Conflict responses replace local state with authoritative `current_state`.
   */
  async function sendAction(action: PendingAction): Promise<void> {
    const current = sessionRef.current;
    if (!current) return;
    setUx('submitting');
    setBanner(null);
    setPending(action);
    // Persist before the request so refresh/restart keeps the same client_action_id.
    retainPending(action);
    try {
      const updated = await api.submitAction(current.session_id, {
        client_action_id: action.client_action_id,
        expected_state_version: action.expected_state_version,
        action_type: action.action_type,
        payload: action.payload,
      });
      setSession(updated);
      dropPending();
      setPending(null);
      setUx('idle');
      if (updated.message) setBanner(updated.message);
    } catch (err) {
      if (err instanceof ApiRequestError && err.currentState) {
        setSession(err.currentState);
        dropPending();
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
        dropPending();
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
      dropPending();
      setPending(null);
      setUx('fatal');
      setBanner('Unexpected error. Reload from server.');
    }
  }

  async function submit(actionType: ActionType, payload: ActionPayload): Promise<void> {
    if (!session || pending || ux === 'submitting') return;
    const action = createPendingAction(
      session.session_id,
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
    dropPending();
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
          pendingActionId={pending?.client_action_id ?? null}
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
            // Keep persisted pending so Resume can retry after leaving the screen.
            const stored = loadPendingAction();
            setPending(stored && stored.session_id === session.session_id ? stored : null);
            setBanner(null);
            setUx(stored ? 'retry' : 'idle');
          }}
        />
      )}
    </div>
  );
}

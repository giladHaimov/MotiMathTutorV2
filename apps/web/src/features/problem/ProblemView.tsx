import { useState } from 'react';
import type { PublicSession, Slot } from '@app/contracts';

export type ProblemUx = 'idle' | 'submitting' | 'conflict' | 'retry' | 'offline' | 'fatal';

export function ProblemView({
  session,
  banner,
  ux,
  pending,
  submitting,
  pendingActionId,
  onAssign,
  onDelete,
  onContinue,
  onAcknowledge,
  onSubmitAnswer,
  onRetry,
  onReload,
  onBack,
}: {
  session: PublicSession;
  banner: string | null;
  ux: ProblemUx;
  pending: boolean;
  submitting: boolean;
  pendingActionId: string | null;
  onAssign: (slot: Slot, tokenId: string) => void;
  onDelete: (slot: Slot) => void;
  onContinue: () => void;
  onAcknowledge: () => void;
  onSubmitAnswer: (value: string) => void;
  onRetry: () => void;
  onReload: () => void;
  onBack: () => void;
}): React.JSX.Element {
  const [selectedToken, setSelectedToken] = useState<string | null>(null);
  const [answer, setAnswer] = useState('');

  // Controls are gated exclusively by server `allowed_actions` (AC-050).
  // A pending/retrying action blocks new submits so the same client_action_id is reused.
  const actionsLocked = submitting || pending;
  const canAssign = session.allowed_actions.includes('ASSIGN_SLOT') && !actionsLocked;
  const canDelete = session.allowed_actions.includes('DELETE_ASSIGNMENT') && !actionsLocked;
  const canContinue = session.allowed_actions.includes('SUBMIT_COMMITMENT') && !actionsLocked;
  const canAcknowledge =
    session.allowed_actions.includes('ACKNOWLEDGE_INSUFFICIENT_INFORMATION') && !actionsLocked;
  const canSubmitAnswer = session.allowed_actions.includes('SUBMIT_FINAL_ANSWER') && !actionsLocked;
  const isCompleted = session.status === 'COMPLETED';
  const showRetry = ux === 'retry' || ux === 'offline' || (pending && isCompleted);

  // Tokens already placed anywhere in the workspace should not be re-offered.
  const placed = new Set(
    session.workspace.slots.map((s) => s.token_id).filter((id): id is string => id !== null),
  );

  // COMPLETED must never hide a still-pending final-answer action (reconcile should
  // clear it first; this UI is the last-resort safeguard against stranding).
  if (isCompleted && !pending) {
    return (
      <div className="card" data-testid="problem-screen">
        <button type="button" data-testid="back" onClick={onBack}>
          ← Dashboard
        </button>
        <div data-testid="completed">
          <h2>Completed</h2>
          <p data-testid="result">Session complete.</p>
          <p>
            Status: <span data-testid="status">{session.status}</span>
          </p>
        </div>
        <button type="button" data-testid="back-dashboard" onClick={onBack}>
          Back to dashboard
        </button>
      </div>
    );
  }

  return (
    <div className="card" data-testid="problem-screen" aria-label="problem-screen">
      {pendingActionId && (
        <span data-testid="pending-action-id" hidden>
          {pendingActionId}
        </span>
      )}
      <button
        type="button"
        data-testid="back"
        aria-label="back-to-dashboard"
        onClick={onBack}
        disabled={submitting}
      >
        ← Dashboard
      </button>
      <p>
        State version:{' '}
        <span data-testid="state-version" aria-label={`state-version-${session.state_version}`}>
          {session.state_version}
        </span>{' '}
        · Status: <span data-testid="status">{session.status}</span>
      </p>
      {isCompleted && (
        <div data-testid="completed">
          <h2>Completed</h2>
          <p data-testid="result">Session complete — pending action still needs reconcile/retry.</p>
        </div>
      )}
      {session.required_next_action.action_type && (
        <p data-testid="required-next">Next: {session.required_next_action.action_type}</p>
      )}
      {session.accepted_commitments.length > 0 && (
        <p data-testid="accepted-commitments">
          Commitments: {session.accepted_commitments.join(', ')}
        </p>
      )}

      {submitting && (
        <p className="status-line" data-testid="submitting" role="status">
          Sending action…
        </p>
      )}

      {!isCompleted && (
        <>
          <h2>Problem</h2>
          {session.visible_chunks.map((chunk) => (
            <div
              key={chunk.order_index}
              className="chunk"
              data-testid={`chunk-${chunk.order_index}`}
            >
              <div>{chunk.content}</div>
              <div>
                {chunk.tokens.map((token) => (
                  <button
                    key={token.token_id}
                    className="token"
                    data-testid={`token-${token.token_id}`}
                    aria-label={`token-${token.token_id}`}
                    disabled={placed.has(token.token_id) || !canAssign}
                    aria-pressed={selectedToken === token.token_id}
                    onClick={() => setSelectedToken(token.token_id)}
                  >
                    {token.text}
                  </button>
                ))}
              </div>
            </div>
          ))}

          <h2>Workspace</h2>
          {session.workspace.slots.map((slot) => (
            <div
              key={slot.slot}
              className={`slot ${slot.token_id ? 'slot--filled' : ''}`}
              data-testid={`slot-${slot.slot}`}
            >
              <strong>{slot.slot}</strong>
              {slot.token_id ? (
                <>
                  <span data-testid={`slot-label-${slot.slot}`}>{slot.label}</span>
                  <button
                    type="button"
                    data-testid={`delete-${slot.slot}`}
                    disabled={!canDelete}
                    onClick={() => onDelete(slot.slot)}
                  >
                    Delete
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  data-testid={`assign-${slot.slot}`}
                  aria-label={`assign-${slot.slot}`}
                  disabled={!selectedToken || !canAssign}
                  onClick={() => {
                    if (selectedToken) {
                      onAssign(slot.slot, selectedToken);
                      setSelectedToken(null);
                    }
                  }}
                >
                  Place selected here
                </button>
              )}
            </div>
          ))}

          <div className="actions">
            <button
              type="button"
              data-testid="continue"
              disabled={!canContinue}
              onClick={onContinue}
            >
              Continue
            </button>
            {canAcknowledge && (
              <button type="button" data-testid="acknowledge" onClick={onAcknowledge}>
                Acknowledge insufficient information
              </button>
            )}
          </div>

          {canSubmitAnswer && (
            <div className="final-answer" data-testid="final-answer">
              <label htmlFor="final-answer-input">Final answer</label>
              <input
                id="final-answer-input"
                data-testid="final-answer-input"
                aria-label="final-answer-input"
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                inputMode="numeric"
                disabled={actionsLocked}
              />
              <button
                type="button"
                data-testid="submit-answer"
                disabled={answer.trim() === '' || actionsLocked}
                onClick={() => {
                  onSubmitAnswer(answer);
                  setAnswer('');
                }}
              >
                Submit answer
              </button>
            </div>
          )}
        </>
      )}

      {banner && (
        <p
          className={ux === 'conflict' ? 'message message--conflict' : 'message'}
          data-testid="message"
          role="status"
        >
          {banner}
        </p>
      )}
      {session.guidance_code && (
        <p className="guidance" data-testid="guidance-code">
          {session.guidance_code}
        </p>
      )}

      {showRetry && (
        <button
          type="button"
          data-testid="retry-action"
          className="retry"
          disabled={submitting}
          onClick={onRetry}
        >
          Retry same action
        </button>
      )}

      <button type="button" data-testid="reload" onClick={onReload} disabled={submitting}>
        Reload from server
      </button>
    </div>
  );
}

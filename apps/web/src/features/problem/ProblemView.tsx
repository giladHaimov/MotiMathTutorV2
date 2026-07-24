import { useState } from 'react';
import type { PublicSession, Slot } from '@app/contracts';

export function ProblemView({
  session,
  banner,
  onAssign,
  onDelete,
  onContinue,
  onAcknowledge,
  onSubmitAnswer,
  onReload,
  onBack,
}: {
  session: PublicSession;
  banner: string | null;
  onAssign: (slot: Slot, tokenId: string) => void;
  onDelete: (slot: Slot) => void;
  onContinue: () => void;
  onAcknowledge: () => void;
  onSubmitAnswer: (value: string) => void;
  onReload: () => void;
  onBack: () => void;
}): React.JSX.Element {
  const [selectedToken, setSelectedToken] = useState<string | null>(null);
  const [answer, setAnswer] = useState('');

  const canAssign = session.allowed_actions.includes('ASSIGN_SLOT');
  const canDelete = session.allowed_actions.includes('DELETE_ASSIGNMENT');
  const canContinue = session.allowed_actions.includes('SUBMIT_COMMITMENT');
  const canAcknowledge = session.allowed_actions.includes('ACKNOWLEDGE_INSUFFICIENT_INFORMATION');
  const canSubmitAnswer = session.allowed_actions.includes('SUBMIT_FINAL_ANSWER');
  const isCompleted = session.status === 'COMPLETED';

  // Tokens already placed anywhere in the workspace should not be re-offered.
  const placed = new Set(
    session.workspace.slots.map((s) => s.token_id).filter((id): id is string => id !== null),
  );

  if (isCompleted) {
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
    <div className="card" data-testid="problem-screen">
      <button type="button" data-testid="back" onClick={onBack}>
        ← Dashboard
      </button>
      <p>
        State version: <span data-testid="state-version">{session.state_version}</span> · Status:{' '}
        <span data-testid="status">{session.status}</span>
      </p>
      {session.required_next_action.action_type && (
        <p data-testid="required-next">Next: {session.required_next_action.action_type}</p>
      )}
      {session.accepted_commitments.length > 0 && (
        <p data-testid="accepted-commitments">
          Commitments: {session.accepted_commitments.join(', ')}
        </p>
      )}

      <h2>Problem</h2>
      {session.visible_chunks.map((chunk) => (
        <div key={chunk.order_index} className="chunk" data-testid={`chunk-${chunk.order_index}`}>
          <div>{chunk.content}</div>
          <div>
            {chunk.tokens.map((token) => (
              <button
                key={token.token_id}
                className="token"
                data-testid={`token-${token.token_id}`}
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
        <button type="button" data-testid="continue" disabled={!canContinue} onClick={onContinue}>
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
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            inputMode="numeric"
          />
          <button
            type="button"
            data-testid="submit-answer"
            disabled={answer.trim() === ''}
            onClick={() => {
              onSubmitAnswer(answer);
              setAnswer('');
            }}
          >
            Submit answer
          </button>
        </div>
      )}

      {banner && (
        <p className="message" data-testid="message">
          {banner}
        </p>
      )}
      {session.guidance_code && (
        <p className="guidance" data-testid="guidance-code">
          {session.guidance_code}
        </p>
      )}
      <button type="button" data-testid="reload" onClick={onReload}>
        Reload from server
      </button>
    </div>
  );
}

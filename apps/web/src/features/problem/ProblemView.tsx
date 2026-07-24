import { useState } from 'react';
import type { PublicSession, Slot } from '@app/contracts';

export function ProblemView({
  session,
  banner,
  onAssign,
  onDelete,
  onReload,
  onBack,
}: {
  session: PublicSession;
  banner: string | null;
  onAssign: (slot: Slot, tokenId: string) => void;
  onDelete: (slot: Slot) => void;
  onReload: () => void;
  onBack: () => void;
}): React.JSX.Element {
  const [selectedToken, setSelectedToken] = useState<string | null>(null);

  // Tokens already placed anywhere in the workspace should not be re-offered.
  const placed = new Set(
    session.workspace.slots.map((s) => s.token_id).filter((id): id is string => id !== null),
  );

  return (
    <div className="card" data-testid="problem-screen">
      <button type="button" data-testid="back" onClick={onBack}>
        ← Dashboard
      </button>
      <p>
        State version: <span data-testid="state-version">{session.state_version}</span> · Status:{' '}
        <span data-testid="status">{session.status}</span>
      </p>

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
                disabled={placed.has(token.token_id)}
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
                onClick={() => onDelete(slot.slot)}
              >
                Delete
              </button>
            </>
          ) : (
            <button
              type="button"
              data-testid={`assign-${slot.slot}`}
              disabled={!selectedToken || session.status !== 'ACTIVE'}
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

      {banner && (
        <p className="message" data-testid="message">
          {banner}
        </p>
      )}
      <button type="button" data-testid="reload" onClick={onReload}>
        Reload from server
      </button>
    </div>
  );
}

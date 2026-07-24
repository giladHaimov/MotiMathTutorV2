/**
 * Test-only fault-injection seam for the accepted-transition transaction.
 *
 * The session service invokes {@link runPostAcceptWriteHook} once, still INSIDE
 * the transaction, after the session update + attempt insert + event inserts and
 * before commit. Tests set a hook that throws to prove the whole unit rolls back
 * atomically (AC-021). It is a hard no-op in production: the hook is never set
 * there, and invocation is additionally gated off when NODE_ENV==='production',
 * so it can never introduce a production code path.
 */
type PostWriteHook = () => void | Promise<void>;

let postAcceptWriteHook: PostWriteHook | null = null;

/** Install (or clear with `null`) the post-accept-write hook. Test use only. */
export function setPostAcceptWriteHook(hook: PostWriteHook | null): void {
  postAcceptWriteHook = hook;
}

export async function runPostAcceptWriteHook(): Promise<void> {
  if (process.env.NODE_ENV === 'production') return;
  if (postAcceptWriteHook) await postAcceptWriteHook();
}

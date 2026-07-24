import { useState } from 'react';
import { api, ApiRequestError } from '../../lib/api/client.js';

export function AuthView({ onAuthenticated }: { onAuthenticated: () => void }): React.JSX.Element {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === 'register') {
        await api.signUp(email, password, name || email.split('@')[0]!);
      } else {
        await api.signIn(email, password);
      }
      onAuthenticated();
    } catch (err) {
      setError(err instanceof ApiRequestError ? 'Invalid credentials.' : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" data-testid="auth-view">
      <h1>{mode === 'login' ? 'Log in' : 'Create account'}</h1>
      <form onSubmit={submit}>
        {mode === 'register' && (
          <>
            <label htmlFor="name">Name</label>
            <input
              id="name"
              data-testid="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </>
        )}
        <label htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          data-testid="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <label htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          data-testid="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <button type="submit" data-testid="submit-auth" disabled={busy}>
          {mode === 'login' ? 'Log in' : 'Register'}
        </button>
      </form>
      {error && (
        <p className="error" data-testid="auth-error">
          {error}
        </p>
      )}
      <button
        type="button"
        data-testid="toggle-mode"
        onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
      >
        {mode === 'login' ? 'Need an account? Register' : 'Have an account? Log in'}
      </button>
    </div>
  );
}

import { useState } from "react";
import { api } from "../../lib/api";

export function Login({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const dev = import.meta.env.DEV;

  return (
    <main>
      <h1>Custom Rating</h1>
      <p className="muted">Six questions about anything you've experienced.</p>
      <a className="button primary" href="/api/v1/auth/google">Sign in with Google</a>
      {dev && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setFailed(false);
            try {
              await api("/auth/dev-login", { method: "POST", body: { email } });
              onDone();
            } catch {
              setFailed(true);
            }
            setBusy(false);
          }}
        >
          <label>
            Dev login (local only)
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="me@example.com" />
          </label>
          {failed && <p role="alert">Dev login failed. Start the API with DEV_LOGIN=1.</p>}
          <button disabled={busy}>Continue</button>
        </form>
      )}
    </main>
  );
}

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { call, client, type Me } from "../../lib/api";
import { ReviewList } from "../feed/ReviewList";

type Request = { id: string; displayName: string };

export function Profile({ onLogout, onChanged }: { onLogout: (everywhere: boolean) => Promise<void>; onChanged: () => void }) {
  const [me, setMe] = useState<Me>();
  const [error, setError] = useState<string>();
  const [requests, setRequests] = useState<Request[]>([]);

  const load = useCallback(async () => {
    try {
      const m = await call(client.me.$get());
      setMe(m);
      setRequests(m.requests ? (await call(client.me["follow-requests"].$get())).data : []);
    } catch {
      setError("Couldn't load your profile.");
    }
  }, []);
  useEffect(() => void load(), [load]);

  if (error) return <p role="alert">{error} <button onClick={() => { setError(undefined); void load(); }}>Retry</button></p>;
  if (!me) return <p className="muted" aria-busy="true">Loading…</p>;

  const answer = async (id: string, verb: "accept" | "decline") => {
    await call(client.me["follow-requests"][":userId"][verb].$post({ param: { userId: id } }));
    await load();
  };

  return (
    <>
      <section className="profile-head" aria-label="Your profile">
        {me.avatarUrl
          ? <img className="avatar" src={me.avatarUrl} alt="" referrerPolicy="no-referrer" width={64} height={64} />
          : <span className="avatar" aria-hidden="true">{me.displayName.slice(0, 1).toUpperCase()}</span>}
        <div>
          <h1>{me.displayName}</h1>
          <small>{me.email} · member since {new Date(me.createdAt).toLocaleDateString(undefined, { year: "numeric", month: "short" })}</small>
        </div>
      </section>

      <dl className="stats">
        <div><dt>Reviews</dt><dd>{me.reviews}</dd></div>
        <div><dt>Followers</dt><dd>{me.followers}</dd></div>
        <div><dt>Following</dt><dd>{me.following}</dd></div>
      </dl>

      {requests.length > 0 && (
        <section aria-labelledby="requests-h" className="card">
          <h2 id="requests-h">Follow requests</h2>
          <ul className="list">
            {requests.map((r) => (
              <li key={r.id} className="request">
                <span>{r.displayName}</span>
                <span className="row-meta">
                  <button className="primary" onClick={() => void answer(r.id, "accept")}>Accept</button>
                  <button onClick={() => void answer(r.id, "decline")}>Decline</button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Settings me={me} onSaved={() => { onChanged(); void load(); }} />

      <section aria-labelledby="session-h" className="card">
        <h2 id="session-h">Session</h2>
        <p className="actions">
          <button onClick={() => void onLogout(false)}>Sign out</button>
          <button onClick={() => void onLogout(true)}>Sign out everywhere</button>
        </p>
        <small>“Everywhere” ends your sessions on every device you're signed in on.</small>
      </section>

      <h2 className="section">Your reviews</h2>
      <ReviewList listKey="mine" load={(cursor) => call(client.me.reviews.$get({ query: { cursor } }))} empty="You haven't reviewed anything yet." />
    </>
  );
}

function Settings({ me, onSaved }: { me: Me; onSaved: () => void }) {
  const [name, setName] = useState(me.displayName);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean }>();

  const patch = async (json: { displayName?: string; isPrivate?: boolean }, ok: string) => {
    setBusy(true);
    setMsg(undefined);
    try {
      await call(client.me.$patch({ json }));
      setMsg({ text: ok });
      onSaved();
    } catch {
      setMsg({ text: "Couldn't save. Try again.", bad: true });
    } finally {
      setBusy(false);
    }
  };

  const save = (e: FormEvent) => {
    e.preventDefault();
    void patch({ displayName: name.trim() }, "Name saved.");
  };
  const trimmed = name.trim();

  return (
    <section aria-labelledby="settings-h" className="card">
      <h2 id="settings-h">Settings</h2>
      <form onSubmit={save}>
        <label>
          Display name
          <input type="text" value={name} maxLength={60} required onChange={(e) => setName(e.target.value)} />
        </label>
        <button className="primary" disabled={busy || !trimmed || trimmed === me.displayName}>Save name</button>
      </form>
      <label className="toggle">
        <input
          type="checkbox"
          checked={me.isPrivate}
          disabled={busy}
          onChange={(e) => void patch({ isPrivate: e.target.checked }, e.target.checked ? "Your account is private." : "Your account is public.")}
        />
        <span>Private account<small>People must ask to follow you. Turning this off approves anyone waiting.</small></span>
      </label>
      <p role={msg?.bad ? "alert" : "status"} className={msg?.bad ? undefined : "muted"}>{msg?.text}</p>
    </section>
  );
}

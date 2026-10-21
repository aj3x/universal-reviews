import { useCallback, useEffect, useState } from "react";
import { Profile } from "./features/account/Profile";
import { Login } from "./features/auth/Login";
import { Feed } from "./features/feed/Feed";
import { ItemView } from "./features/item/ItemView";
import { NewReview } from "./features/review/NewReview";
import { ApiError, call, client, SESSION_EXPIRED, type ReviewModel } from "./lib/api";
import { useRoute } from "./lib/route";

type User = { id: string; displayName: string };

export function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [model, setModel] = useState<ReviewModel>();
  const [error, setError] = useState<string>();
  const [route0, route1] = useRoute();

  const load = useCallback(async () => {
    try {
      setModel(await call(client["review-model"].$get({ query: {} })));
      setUser(await call(client.me.$get()));
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setUser(null);
      else setError("Can't reach the server. Try again in a moment.");
    }
  }, []);
  useEffect(() => void load(), [load]);
  useEffect(() => {
    const expired = () => setUser(null);
    addEventListener(SESSION_EXPIRED, expired);
    return () => removeEventListener(SESSION_EXPIRED, expired);
  }, []);

  if (error) return <main><p role="alert">{error}</p><button onClick={() => { setError(undefined); void load(); }}>Retry</button></main>;
  if (user === undefined || !model) return <main aria-busy="true"><p className="muted">Loading…</p></main>;
  if (user === null) return <Login onDone={load} />;

  const logout = async (everywhere: boolean) => {
    await call(everywhere ? client.me.sessions.$delete() : client.auth.logout.$post());
    setUser(null);
    location.hash = "/";
  };

  return (
    <>
      <button type="button" className="skip" onClick={() => document.getElementById("main")?.focus()}>Skip to content</button>
      <header>
        <nav aria-label="Main">
          <a href="#/" aria-current={!route0 ? "page" : undefined}>Feed</a>
          <a href="#/profile" aria-current={route0 === "profile" ? "page" : undefined}>Profile</a>
          <a href="#/new" className="primary" aria-current={route0 === "new" ? "page" : undefined}>Review</a>
        </nav>
      </header>
      <main id="main" tabIndex={-1}>
        {!route0 && <Feed />}
        {route0 === "profile" && <Profile onLogout={logout} onChanged={load} />}
        {route0 === "new" && <NewReview model={model} />}
        {route0 === "item" && route1 && <ItemView id={route1} />}
      </main>
    </>
  );
}

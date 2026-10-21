import { usePaged, type LoadPage } from "../../lib/usePaged";
import { ReviewCard } from "./ReviewCard";

export function ReviewList({ listKey, load, empty, showItem }: { listKey: string; load: LoadPage; empty: string; showItem?: boolean }) {
  const { rows, next, state, more } = usePaged(listKey, load);
  return (
    <>
      {rows.map((r) => <ReviewCard key={r.id} r={r} showItem={showItem} />)}
      {state === "loading" && <p className="muted">Loading…</p>}
      {state === "error" && <p role="alert">Couldn't load. <button onClick={() => void more(rows.at(-1)?.id)}>Retry</button></p>}
      {state === "ready" && !rows.length && <p className="muted">{empty}</p>}
      {next && state === "ready" && <button onClick={() => void more(next)}>Load more</button>}
    </>
  );
}

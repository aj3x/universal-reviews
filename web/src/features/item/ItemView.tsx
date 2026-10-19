import { useEffect, useState } from "react";
import { api, type Item } from "../../lib/api";
import { SCORES } from "../feed/ReviewCard";
import { ReviewList } from "../feed/ReviewList";

export function ItemView({ id }: { id: string }) {
  const [item, setItem] = useState<Item | null | undefined>();
  useEffect(() => { api<Item>(`/items/${id}`).then(setItem).catch(() => setItem(null)); }, [id]);
  if (item === undefined) return <p className="muted">Loading…</p>;
  if (item === null) return <p role="alert">Not found.</p>;
  return (
    <>
      <h1>{item.title} <span className="tag">{item.kind}</span></h1>
      {item.details && "address" in item.details && item.details.address && <p className="muted">{item.details.address}</p>}
      {item.details && "year" in item.details && (
        <p className="muted">{[item.details.year, item.details.runtime && `${item.details.runtime} min`, item.details.director].filter(Boolean).join(" · ")}</p>
      )}
      <p className="muted">{item.stats.reviewCount} {item.stats.reviewCount === 1 ? "review" : "reviews"}</p>
      {item.stats.reviewCount > 0 && (
        <dl className="scores">
          {SCORES.map((f) => (<div key={f}><dt>{f}</dt><dd>{item.stats.averages[f] ?? "–"}</dd></div>))}
        </dl>
      )}
      <p><a className="button primary" href={`#/new?item=${item.id}`}>Review this</a></p>
      <ReviewList path={`/items/${id}/reviews`} empty="No reviews yet." showItem={false} />
    </>
  );
}

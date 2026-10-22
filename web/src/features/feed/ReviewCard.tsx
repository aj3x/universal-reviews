import { label, type Review, type ScoreField } from "../../lib/api";

export const SCORES: ScoreField[] = ["enjoyment", "impact", "value", "aesthetic"];

export function ReviewCard({ r, showItem = true }: { r: Review; showItem?: boolean }) {
  return (
    <article className="card">
      <header>
        {showItem && r.item && <h2><a href={`#/item/${r.item.id}`}>{r.item.title}</a> <span className="tag">{r.item.kind}</span>
          {r.item.restaurant && <small className="muted"> at <a href={`#/item/${r.item.restaurant.id}`}>{r.item.restaurant.title}</a></small>}</h2>}
        <p className="muted">{r.author.displayName} · {new Date(r.createdAt).toLocaleDateString()}</p>
      </header>
      <dl className="scores">
        {SCORES.map((f) => (<div key={f}><dt>{f}</dt><dd>{r.scores[f]}</dd></div>))}
      </dl>
      <p className="muted">Revisit: {label(r.revisit)} · Recommend to: {label(r.recommendTo)}</p>
      {r.notes && <p>{r.notes}</p>}
    </article>
  );
}

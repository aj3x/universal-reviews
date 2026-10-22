import { useEffect, useState } from "react";
import { ApiError, call, client, type DishRow, type ItemDetail } from "../../lib/api";
import { SCORES } from "../feed/ReviewCard";
import { ReviewList } from "../feed/ReviewList";

export function ItemView({ id }: { id: string }) {
  const [item, setItem] = useState<ItemDetail | null | undefined>();
  useEffect(() => { call(client.items[":id"].$get({ param: { id } })).then(setItem).catch(() => setItem(null)); }, [id]);
  if (item === undefined) return <p className="muted">Loading…</p>;
  if (item === null) return <p role="alert">Not found.</p>;
  return (
    <>
      {item.kind === "dish" ? <DishTitle item={item} onRenamed={setItem} /> : <h1>{item.title} <span className="tag">{item.kind}</span></h1>}
      {item.restaurant && <p className="muted">at <a href={`#/item/${item.restaurant.id}`}>{item.restaurant.title}</a></p>}
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
      {item.kind === "restaurant" && <Dishes restaurantId={item.id} />}
      <ReviewList
        listKey={`item:${id}`}
        load={(cursor) => call(client.items[":id"].reviews.$get({ param: { id }, query: { cursor } }))}
        empty="No reviews yet."
        showItem={false}
      />
    </>
  );
}

/** A dish's heading, with a form to rename it in place. */
function DishTitle({ item, onRenamed }: { item: ItemDetail; onRenamed: (item: ItemDetail) => void }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(item.title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const name = title.trim();
    if (!name) return;
    if (name === item.title) return setEditing(false);
    setBusy(true);
    setError(undefined);
    try {
      onRenamed(await call(client.items[":id"].$patch({ param: { id: item.id }, json: { title: name } })));
      setEditing(false);
    } catch (err) {
      setError(err instanceof ApiError && err.code === "title_taken" ? "This restaurant already has a dish with that name." : "Couldn't rename it. Try again.");
    }
    setBusy(false);
  }

  if (!editing) {
    return (
      <h1>
        {item.title} <span className="tag">{item.kind}</span>{" "}
        <button type="button" onClick={() => { setTitle(item.title); setError(undefined); setEditing(true); }}>Rename</button>
      </h1>
    );
  }
  return (
    <form onSubmit={save}>
      <label>
        Dish name
        <input value={title} maxLength={200} autoFocus onChange={(e) => setTitle(e.target.value)} />
      </label>
      <button className="primary" disabled={busy || !title.trim()}>Save</button>
      <button type="button" onClick={() => setEditing(false)}>Cancel</button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}

/** The dishes people have added under a restaurant, and a box to add another. */
function Dishes({ restaurantId }: { restaurantId: string }) {
  const [dishes, setDishes] = useState<DishRow[]>();
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => {
    setDishes(undefined);
    call(client.items[":id"].dishes.$get({ param: { id: restaurantId } })).then((r) => setDishes(r.data)).catch(() => setDishes([]));
  }, [restaurantId]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const name = title.trim();
    if (!name) return;
    setBusy(true);
    setError(undefined);
    try {
      const dish = await call(client.items[":id"].dishes.$post({ param: { id: restaurantId }, json: { title: name } }));
      location.hash = `#/new?item=${dish.id}`; // straight to reviewing what you just added
    } catch (err) {
      setError(err instanceof ApiError ? "Couldn't add it. Try again." : "Something went wrong.");
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="dishes-h">
      <h2 id="dishes-h">Dishes</h2>
      {dishes === undefined ? <p className="muted">Loading…</p> : dishes.length === 0 ? <p className="muted">No dishes yet.</p> : (
        <ul className="list">
          {dishes.map((d) => (
            <li key={d.id}>
              <a className={d.myOverall !== null ? "button row reviewed" : "button row"} href={`#/item/${d.id}`}>
                <span className="row-main">{d.title}<small className="muted">{d.reviewCount} {d.reviewCount === 1 ? "review" : "reviews"}</small></span>
                <span className="row-meta">
                  {d.overall !== null && <strong className="score" aria-label={`Average overall score ${d.overall}`}>{d.overall.toFixed(1)}</strong>}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={add}>
        <label>
          Add a dish
          <input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <button className="primary" disabled={busy || !title.trim()}>Add and review</button>
        {error && <p role="alert">{error}</p>}
      </form>
    </section>
  );
}

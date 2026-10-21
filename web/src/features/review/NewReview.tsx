import { useEffect, useRef, useState } from "react";
import { metersToString } from "../../lib/places";
import { api, ApiError, label, type Item, type ItemRow, type Kind, type ReviewModel, type ScoreField, type Scores } from "../../lib/api";

type MovieHit = { tmdbId: number; title: string; year: number | null };
type Suggestion = { placeId: string; name: string; secondary: string, distanceMeters?: number, types: string[] };

export function NewReview({ model }: { model: ReviewModel }) {
  const preset = new URLSearchParams(location.hash.split("?")[1]).get("item");
  const [item, setItem] = useState<{ id: string; kind: Kind; title: string } | null>(null);
  useEffect(() => {
    if (preset) api<Item>(`/items/${preset}`).then(setItem).catch(() => {});
  }, [preset]);

  return item ? <Form model={model} item={item} onBack={() => setItem(null)} /> : <Pick model={model} onPick={setItem} />;
}

function Pick({ model, onPick }: { model: ReviewModel; onPick: (i: { id: string; kind: Kind; title: string }) => void }) {
  const kinds = model.enabledKinds;
  const [kind, setKind] = useState<Kind>(kinds[0] ?? "restaurant");
  const [q, setQ] = useState("");
  const [found, setFound] = useState<ItemRow[]>([]);
  const [places, setPlaces] = useState<Suggestion[]>([]);
  const [movies, setMovies] = useState<MovieHit[]>([]);
  const [error, setError] = useState<string>();
  const session = useRef(crypto.randomUUID());
  const here = useRef<{ lat: number; lng: number } | undefined>(undefined);

  useEffect(() => {
    if (kind !== "restaurant" || here.current) return;
    navigator.geolocation?.getCurrentPosition(
      (p) => { here.current = { lat: p.coords.latitude, lng: p.coords.longitude }; },
      () => {},
      { maximumAge: 300000 },
    );
  }, [kind]);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setFound([]); setPlaces([]); setMovies([]); return; }
    const t = setTimeout(async () => {
      api<{ data: ItemRow[] }>(`/items?kind=${kind}&q=${encodeURIComponent(term)}&reviewedByMe=1`).then((r) => setFound(r.data)).catch(() => {});
      if (kind === "restaurant") {
        const loc = here.current ? `&lat=${here.current.lat}&lng=${here.current.lng}` : "";
        api<{ data: Suggestion[] }>(`/places/autocomplete?q=${encodeURIComponent(term)}&session=${session.current}${loc}`)
          .then((r) => setPlaces(r.data)).catch(() => setPlaces([]));
      }
      if (kind === "movie") {
        api<{ data: MovieHit[] }>(`/movies/search?q=${encodeURIComponent(term)}`)
          .then((r) => setMovies(r.data)).catch(() => setMovies([]));
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q, kind]);

  const fail = (e: unknown) => setError(e instanceof ApiError && e.code === "kind_not_enabled" ? "That kind isn't available yet." : "Couldn't add it. Try again.");

  // Reviewed items already cover their catalogue match, so list each once.
  const reviewedIds = new Set(found.map((i) => i.externalId).filter(Boolean));
  const newPlaces = places.filter((p) => !reviewedIds.has(p.placeId));
  const newMovies = movies.filter((m) => !reviewedIds.has(String(m.tmdbId)));

  return (
    <>
      <h1>What are you reviewing?</h1>
      {kinds.length > 1 && (
        <div role="radiogroup" aria-label="Kind" className="chips">
          {kinds.map((k) => (
            <label key={k} className="chip"><input type="radio" name="kind" checked={kind === k} onChange={() => { setKind(k); setPlaces([]); setMovies([]); setFound([]); setError(undefined); }} /><span>{k}</span></label>
          ))}
        </div>
      )}
      <label>
        Search or add a {kind}
        <input type="search" autoFocus value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      {error && <p role="alert">{error}</p>}
      {kind === "movie" && <p className="muted"><small>Movie data from TMDB. This product uses the TMDB API but is not endorsed or certified by TMDB.</small></p>}
      <ul className="list">
        {found.map((i) => (
          <li key={i.id}><button className="row" onClick={() => onPick(i)}><span className="row-main">{i.title}{(i.address || i.year) && <small className="muted">{i.address ?? i.year}</small>}</span><small className="badge row-meta">Reviewed</small></button></li>
        ))}
        {newPlaces.map((p) => (
          <li key={p.placeId}>
            <button className="row" onClick={() =>
              api<Item>("/items/from-place", { method: "POST", body: { placeId: p.placeId, name: p.name, sessionToken: session.current } })
                .then(onPick).catch(fail)}>
              <span className="row-main">{p.name}<small className="muted">{p.secondary}</small></span>
              {p.distanceMeters !== undefined && <small className="muted row-meta">{metersToString(p.distanceMeters)}</small>}
            </button>
          </li>
        ))}
        {newMovies.map((m) => (
          <li key={m.tmdbId}>
            <button className="row" onClick={() =>
              api<Item>("/items/from-movie", { method: "POST", body: { tmdbId: m.tmdbId, title: m.title } })
                .then(onPick).catch(fail)}>
              {m.title}{m.year && <small className="muted">{m.year}</small>}
            </button>
          </li>
        ))}
        {q.trim().length >= 2 && (
          <li>
            <button className="row" onClick={() =>
              api<Item>("/items", { method: "POST", body: { kind, title: q.trim() } }).then(onPick).catch(fail)}>
              Add “{q.trim()}” as new
            </button>
          </li>
        )}
      </ul>
    </>
  );
}

function Form({ model, item, onBack }: { model: ReviewModel; item: { id: string; kind: Kind; title: string }; onBack: () => void }) {
  const prompts = model.prompts[item.kind];
  const [scores, setScores] = useState<Partial<Scores>>({});
  const [revisit, setRevisit] = useState("");
  const [recommendTo, setRecommendTo] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const missing = [
    ...model.scoreFields.filter((f) => !scores[f]).map((f) => prompts?.[f] ?? f),
    ...(revisit ? [] : [prompts?.revisit ?? "Revisit"]),
    ...(recommendTo ? [] : [prompts?.recommendTo ?? "Recommend to"]),
  ];
  const complete = missing.length === 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await api("/reviews", { method: "POST", body: { itemId: item.id, scores, revisit, recommendTo, notes: notes.trim() || null } });
      location.hash = `#/item/${item.id}`;
    } catch {
      setError("Couldn't save. Your answers are still here; try again.");
      setBusy(false);
    }
  }

  const range = Array.from({ length: model.scale.max - model.scale.min + 1 }, (_, i) => i + model.scale.min);

  return (
    <form onSubmit={submit}>
      <h1>{item.title}</h1>
      <p className="muted">{model.scale.help} <button type="button" className="link" onClick={onBack}>Change</button></p>
      {model.scoreFields.map((f: ScoreField) => (
        <fieldset key={f}>
          <legend>{prompts?.[f] ?? f}</legend>
          <div className="scale">
            {range.map((n) => (
              <label key={n} className="chip"><input type="radio" name={f} checked={scores[f] === n} onChange={() => setScores({ ...scores, [f]: n })} /><span>{n}</span></label>
            ))}
          </div>
        </fieldset>
      ))}
      <Choice name="revisit" legend={prompts?.revisit ?? "Revisit"} options={model.revisit} value={revisit} onChange={setRevisit} />
      <Choice name="recommendTo" legend={prompts?.recommendTo ?? "Recommend to"} options={model.recommendTo} value={recommendTo} onChange={setRecommendTo} />
      <label>
        Notes (optional)
        <textarea rows={4} maxLength={5000} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      {error && <p role="alert">{error}</p>}
      {!complete && <p className="muted">Still to answer: {missing.length} {missing.length === 1 ? "question" : "questions"}.</p>}
      <button className="primary" disabled={!complete || busy}>Save review</button>
    </form>
  );
}

function Choice({ name, legend, options, value, onChange }: { name: string; legend: string; options: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <fieldset>
      <legend>{legend}</legend>
      <div className="chips">
        {options.map((o) => (
          <label key={o} className="chip"><input type="radio" name={name} checked={value === o} onChange={() => onChange(o)} /><span>{label(o)}</span></label>
        ))}
      </div>
    </fieldset>
  );
}

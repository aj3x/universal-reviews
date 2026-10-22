import { useEffect, useRef, useState } from "react";
import { metersToString } from "../../lib/places";
import {
  ApiError, call, client, label,
  type ItemRow, type Kind, type MovieSuggestion, type MyReview, type MyReviewSummary, type PlaceSuggestion,
  type RecommendTo, type ReviewModel, type Revisit, type ScoreField, type Scores,
} from "../../lib/api";

const RECOMMEND_MARK: Record<RecommendTo, [string, string]> = {
  everyone: ["🙂", "You'd send everyone"],
  most: ["🙂", "You'd send most people"],
  specific_people: ["😐", "You'd send specific people"],
  nobody: ["🙁", "You wouldn't send anyone"],
};

function MyMarks({ s }: { s: MyReviewSummary }) {
  const [face, faceLabel] = RECOMMEND_MARK[s.recommendTo];
  const returns = s.revisit !== "never";
  return (
    <span className="marks">
      <small className="visit-count" aria-label={`${s.visitCount} ${s.visitCount === 1 ? "time" : "times"}`}>×{s.visitCount}</small>
      <span role="img" aria-label={faceLabel}>{face}</span>
      <span role="img" aria-label={returns ? `You'd go back: ${label(s.revisit)}` : "You wouldn't go back"}>{returns ? "🔁" : "🚫"}</span>
      <strong className="score" aria-label={`Your overall score ${s.overall}`}>{s.overall.toFixed(1)}</strong>
    </span>
  );
}

export function NewReview({ model }: { model: ReviewModel }) {
  const preset = new URLSearchParams(location.hash.split("?")[1]).get("item");
  const [item, setItem] = useState<ItemRef | null>(null);
  useEffect(() => {
    if (preset) call(client.items[":id"].$get({ param: { id: preset } })).then(setItem).catch(() => {});
  }, [preset]);

  return item ? <Form model={model} item={item} onBack={() => setItem(null)} /> : <Pick model={model} onPick={setItem} />;
}

function Pick({ model, onPick }: { model: ReviewModel; onPick: (i: ItemRef) => void }) {
  const kinds = model.topLevelKinds; // dishes are added from their restaurant's page
  const [kind, setKind] = useState<Kind>(kinds[0] ?? "restaurant");
  const [q, setQ] = useState("");
  const [found, setFound] = useState<ItemRow[]>([]);
  const [places, setPlaces] = useState<PlaceSuggestion[]>([]);
  const [movies, setMovies] = useState<MovieSuggestion[]>([]);
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
    let stale = false; // typing on, or switching kind, makes earlier responses irrelevant
    const t = setTimeout(() => {
      call(client.items.$get({ query: { kind, q: term, reviewedByMe: "1" } }))
        .then((r) => { if (!stale) setFound(r.data); }).catch(() => {});
      if (kind === "restaurant") {
        const near = here.current ? { lat: String(here.current.lat), lng: String(here.current.lng) } : {};
        call(client.places.autocomplete.$get({ query: { q: term, session: session.current, ...near } }))
          .then((r) => { if (!stale) setPlaces(r.data); }).catch(() => { if (!stale) setPlaces([]); });
      }
      if (kind === "movie") {
        call(client.movies.search.$get({ query: { q: term } }))
          .then((r) => { if (!stale) setMovies(r.data); }).catch(() => { if (!stale) setMovies([]); });
      }
    }, 250);
    return () => { stale = true; clearTimeout(t); };
  }, [q, kind]);

  const fail = (e: unknown) => setError(e instanceof ApiError && e.code === "kind_not_enabled" ? "That kind isn't available yet." : "Couldn't add it. Try again.");

  // A reviewed item and its catalogue match are one row: keep the suggestion's
  // distance and mark it reviewed. Reviewed items with no live match list on their own.
  const reviewedByExternal = new Map(found.filter((i) => i.externalId).map((i) => [i.externalId!, i]));
  const shownExternal = new Set([...places.map((p) => p.placeId), ...movies.map((m) => String(m.tmdbId))]);
  const reviewedOnly = found.filter((i) => !i.externalId || !shownExternal.has(i.externalId));

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
      <p className="sr-only" role="status">{q.trim().length >= 2 ? `${reviewedOnly.length + places.length + movies.length} matches` : ""}</p>
      <ul className="list">
        {reviewedOnly.map((i) => (
          <li key={i.id}>
            <button className="row reviewed" onClick={() => onPick(i)}>
              <span className="row-main">{i.title}{(i.address || i.year) && <small className="muted">{i.address ?? i.year}</small>}</span>
              {i.myReview && <span className="row-meta"><MyMarks s={i.myReview} /></span>}
            </button>
          </li>
        ))}
        {places.map((p) => {
          const mine = reviewedByExternal.get(p.placeId);
          return (
            <li key={p.placeId}>
              <button className={mine ? "row reviewed" : "row"} onClick={() => mine ? onPick(mine) :
                call(client.items["from-place"].$post({ json: { placeId: p.placeId, name: p.name, sessionToken: session.current } }))
                  .then(onPick).catch(fail)}>
                <span className="row-main">{p.name}<small className="muted">{p.secondary}</small></span>
                <span className="row-meta">
                  {p.distanceMeters !== undefined && <small className="muted">{metersToString(p.distanceMeters)}</small>}
                  {mine?.myReview && <MyMarks s={mine.myReview} />}
                </span>
              </button>
            </li>
          );
        })}
        {movies.map((m) => {
          const mine = reviewedByExternal.get(String(m.tmdbId));
          return (
            <li key={m.tmdbId}>
              <button className={mine ? "row reviewed" : "row"} onClick={() => mine ? onPick(mine) :
                call(client.items["from-movie"].$post({ json: { tmdbId: m.tmdbId, title: m.title } }))
                  .then(onPick).catch(fail)}>
                <span className="row-main">{m.title}{m.year && <small className="muted">{m.year}</small>}</span>
                {mine?.myReview && <span className="row-meta"><MyMarks s={mine.myReview} /></span>}
              </button>
            </li>
          );
        })}
        {q.trim().length >= 2 && (
          <li>
            <button className="row" onClick={() =>
              call(client.items.$post({ json: { kind, title: q.trim() } })).then(onPick).catch(fail)}>
              Add “{q.trim()}” as new
            </button>
          </li>
        )}
      </ul>
    </>
  );
}

type ItemRef = { id: string; kind: Kind; title: string };

/** Loads your previous review (if any) so a return visit starts from your last answers. */
function Form({ model, item, onBack }: { model: ReviewModel; item: ItemRef; onBack: () => void }) {
  const [mine, setMine] = useState<MyReview | null | undefined>();
  useEffect(() => {
    setMine(undefined);
    call(client.items[":id"]["my-review"].$get({ param: { id: item.id } })).then(setMine).catch(() => setMine(null));
  }, [item.id]);
  if (mine === undefined) return <p className="muted">Loading…</p>;
  return <ReviewForm model={model} item={item} mine={mine} onBack={onBack} />;
}

const todayIso = () => new Date().toISOString().slice(0, 10);

function ReviewForm({ model, item, mine, onBack }: { model: ReviewModel; item: ItemRef; mine: MyReview | null; onBack: () => void }) {
  const prompts = model.prompts[item.kind];
  const [scores, setScores] = useState<Partial<Scores>>(mine?.scores ?? {});
  const [revisit, setRevisit] = useState<Revisit | "">(mine?.revisit ?? "");
  const [recommendTo, setRecommendTo] = useState<RecommendTo | "">(mine?.recommendTo ?? "");
  const [notes, setNotes] = useState(mine?.notes ?? "");
  const [visitedOn, setVisitedOn] = useState(todayIso());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const missing = [
    ...model.scoreFields.filter((f) => !scores[f]).map((f) => prompts?.[f] ?? f),
    ...(revisit ? [] : [prompts?.revisit ?? "Revisit"]),
    ...(recommendTo ? [] : [prompts?.recommendTo ?? "Recommend to"]),
  ];
  const complete = missing.length === 0;
  const dirty = !mine
    || model.scoreFields.some((f) => scores[f] !== mine.scores[f])
    || revisit !== mine.revisit || recommendTo !== mine.recommendTo || (notes.trim() || null) !== mine.notes;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      if (mine && !dirty) await call(client.items[":id"].visits.$post({ param: { id: item.id }, json: { visitedOn } }));
      else if (complete) {
        await call(client.reviews.$post({
          json: { itemId: item.id, experiencedOn: visitedOn, scores: scores as Scores, revisit: revisit as Revisit, recommendTo: recommendTo as RecommendTo, notes: notes.trim() || null },
        }));
      }
      location.hash = `#/item/${item.id}`;
    } catch {
      setError("Couldn't save. Your answers are still here; try again.");
      setBusy(false);
    }
  }

  const range = Array.from({ length: model.scale.max - model.scale.min + 1 }, (_, i) => i + model.scale.min);
  const times = mine?.visitCount ?? 0;

  return (
    <form onSubmit={submit}>
      <h1>{item.title}</h1>
      <p className="muted">{model.scale.help} <button type="button" className="link" onClick={onBack}>Change</button></p>
      {mine && <p className="muted">You've been here {times} {times === 1 ? "time" : "times"}. Your last answers are filled in; change only what's different.</p>}
      <label>
        {mine ? "When was this visit?" : "When?"}
        <input type="date" value={visitedOn} max={todayIso()} onChange={(e) => setVisitedOn(e.target.value || todayIso())} />
      </label>
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
      <button className="primary" disabled={!complete || busy}>
        {!mine ? "Save review" : dirty ? "Update review & log visit" : "Went again, no changes"}
      </button>
    </form>
  );
}

function Choice<T extends string>({ name, legend, options, value, onChange }: { name: string; legend: string; options: readonly T[]; value: T | ""; onChange: (v: T) => void }) {
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

export type Kind = "restaurant" | "movie" | "book";
export type ScoreField = "enjoyment" | "impact" | "value" | "aesthetic";
export type Scores = Record<ScoreField, number>;

export type Review = {
  id: string;
  itemId: string;
  item?: { id: string; kind: Kind; title: string };
  author: { id: string; displayName: string };
  experiencedOn: string | null;
  scores: Scores;
  revisit: string;
  recommendTo: string;
  notes: string | null;
  createdAt: string;
};

export type Item = {
  id: string;
  kind: Kind;
  title: string;
  details:
    | { address: string | null; cuisine: string | null; priceLevel: number | null }
    | { year: number | null; runtime: number | null; director: string | null }
    | null;
  stats: {
    reviewCount: number;
    averages: Record<ScoreField, number | null>;
  };
};

export type ItemRow = { id: string; kind: Kind; title: string; externalSource?: string | null; externalId?: string | null; address?: string | null; year?: number | null };
export type Page<T> = { data: T[]; nextCursor: string | null };

export type ReviewModel = {
  scale: { min: number; max: number; help: string };
  scoreFields: ScoreField[];
  revisit: string[];
  recommendTo: string[];
  enabledKinds: Kind[];
  prompts: Record<Kind, Record<ScoreField | "revisit" | "recommendTo", string>>;
};

export class ApiError extends Error {
  constructor(public status: number, public code: string) {
    super(code);
  }
}

export async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    method: init?.method ?? "GET",
    headers: init?.body ? { "content-type": "application/json" } : undefined,
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (json as { error?: string }).error ?? "error");
  return json as T;
}

export const label = (s: string) => s.replace(/_/g, " ");

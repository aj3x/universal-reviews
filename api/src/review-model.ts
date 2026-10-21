/**
 * The primary question set. Every review of every kind of item answers the
 * same six questions; only the wording shown to the user changes per kind.
 *
 * Score scale (enjoyment, impact, value, aesthetic): 1–10, relative to
 * everything you have ever experienced of that kind.
 *   1 = worst of all time · 5 = average · 10 = best of all time
 */

export const ITEM_KINDS = ["restaurant", "movie", "book"] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

/** Kinds the app accepts reviews for today. Books are modelled but not switched on. */
export const ENABLED_KINDS: readonly ItemKind[] = ["restaurant", "movie"];

export const SCORE_FIELDS = ["enjoyment", "impact", "value", "aesthetic"] as const;
export type ScoreField = (typeof SCORE_FIELDS)[number];

export const SCORE_MIN = 1;
export const SCORE_MAX = 10;

export const REVISIT = ["never", "once_more", "a_few_times", "regularly", "forever"] as const;
export type Revisit = (typeof REVISIT)[number];

export const RECOMMEND_TO = ["everyone", "most", "specific_people", "nobody"] as const;
export type RecommendTo = (typeof RECOMMEND_TO)[number];

type Prompts = Record<ScoreField | "revisit" | "recommendTo", string>;

/** How each question reads for each medium. The stored field never changes. */
export const PROMPTS: Record<ItemKind, Prompts> = {
  restaurant: {
    enjoyment: "Did you like the meal?",
    impact: "Do you still think about it?",
    value: "Was it worth the price?",
    aesthetic: "Did the room, plating and vibe click?",
    revisit: "How often would you go back?",
    recommendTo: "Who would you send here?",
  },
  movie: {
    enjoyment: "Did you like watching it?",
    impact: "Did it stay with you?",
    value: "Was it worth the time (and ticket)?",
    aesthetic: "Did the look, sound and style click?",
    revisit: "How often would you rewatch it?",
    recommendTo: "Who would you tell to watch it?",
  },
  book: {
    enjoyment: "Did you like reading it?",
    impact: "Did it stay with you?",
    value: "Was it worth the time?",
    aesthetic: "Did the writing and form click?",
    revisit: "How often would you reread it?",
    recommendTo: "Who would you hand it to?",
  },
};

export const SCALE_HELP =
  "1 is the worst of all time, 5 is average, 10 is the best of all time.";

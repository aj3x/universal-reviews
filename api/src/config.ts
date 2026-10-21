import { z } from "zod";

const flag = z.enum(["0", "1"]).default("0").transform((v) => v === "1");
const optional = z.string().trim().transform((v) => v || undefined).optional();

const schema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().min(1).max(65535).default(8080),
    DATABASE_PATH: z.string().min(1).default("./data/rating.db"),
    PUBLIC_URL: optional.pipe(z.url().optional()),
    APP_URL: optional.pipe(z.url().optional()),
    GOOGLE_CLIENT_ID: optional,
    GOOGLE_CLIENT_SECRET: optional,
    GOOGLE_PLACES_API_KEY: optional,
    TMDB_API_KEY: optional,
    ALLOWED_EMAILS: z.string().default(""),
    DEV_LOGIN: flag,
  })
  .superRefine((e, ctx) => {
    if (Boolean(e.GOOGLE_CLIENT_ID) !== Boolean(e.GOOGLE_CLIENT_SECRET)) {
      ctx.addIssue({ code: "custom", path: ["GOOGLE_CLIENT_SECRET"], message: "set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET together" });
    }
    if (e.NODE_ENV === "production") {
      if (!e.PUBLIC_URL) ctx.addIssue({ code: "custom", path: ["PUBLIC_URL"], message: "required in production (OAuth redirects and secure cookies depend on it)" });
      else if (new URL(e.PUBLIC_URL).protocol !== "https:" && !["localhost", "127.0.0.1"].includes(new URL(e.PUBLIC_URL).hostname)) {
        ctx.addIssue({ code: "custom", path: ["PUBLIC_URL"], message: "must be https:// in production" });
      }
    }
  });

export type Config = ReturnType<typeof loadConfig>;

/** Parses and validates the environment once at startup, so a bad deploy fails loudly instead of misbehaving. */
export function loadConfig(env: Record<string, string | undefined>) {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join(".") || "env"}: ${i.message}`);
    throw new Error(`Invalid configuration:\n${lines.join("\n")}`);
  }
  const e = parsed.data;
  const publicUrl = e.PUBLIC_URL ?? `http://localhost:${e.PORT}`;
  return {
    production: e.NODE_ENV === "production",
    port: e.PORT,
    databasePath: e.DATABASE_PATH,
    publicUrl,
    appUrl: e.APP_URL ?? publicUrl,
    googleClientId: e.GOOGLE_CLIENT_ID,
    googleClientSecret: e.GOOGLE_CLIENT_SECRET,
    placesApiKey: e.GOOGLE_PLACES_API_KEY,
    tmdbApiKey: e.TMDB_API_KEY,
    allowedEmails: new Set(e.ALLOWED_EMAILS.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)),
    devLogin: e.NODE_ENV !== "production" && e.DEV_LOGIN,
    secureCookies: publicUrl.startsWith("https://"),
  };
}

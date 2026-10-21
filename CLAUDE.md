# Notes for LLMs working in this repo

**This project is in the prototyping phase.** Breaking changes are fine and expected: change
the schema, API shapes, enum values and UI freely when it makes the design better. Do not add
backwards-compatibility shims, deprecation paths, or API versioning for them. There is no
production data to protect yet.

Still keep migrations runnable (`api/drizzle`), keep the Node API and the Rust read service
(`rust/`) in agreement (`scripts/parity.sh`), and update `README.md` and `docs/` when the
review model changes. See `README.md` for the repo layout.

Types: the web app's API types come from the server through Hono's typed client (`ApiType` in
`api/src/app.ts`). Never hand-copy a response type into `web/`. If a route's type is too loose
(`string` where a union belongs), fix it in the API. The API runs as TypeScript directly on Node
(no `tsx`, no build): use `.ts` extensions in relative imports and erasable syntax only (no
`enum`, no constructor parameter properties).

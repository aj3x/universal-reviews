import { createHash, randomBytes } from "node:crypto";
import { ulid } from "ulid";

export const newId = () => ulid();

/** 32 random bytes, base64url. Sent to the browser; only its hash is stored. */
export const newSessionToken = () => randomBytes(32).toString("base64url");

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

import { z } from "zod";
import { tomorrow } from "./dates.ts";

/** A real YYYY-MM-DD that is not in the future (one day of slack for time zones). */
export const visitDate = z.iso.date().refine((d) => d <= tomorrow(), "date is in the future");

/** Query strings are all strings. Schemas only declare what each endpoint reads, which is what the typed client sees. */
const opt = z.string().optional();
export const pageQuery = z.object({ cursor: opt, limit: opt });

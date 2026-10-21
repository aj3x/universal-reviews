import { z } from "zod";
import { tomorrow } from "./dates.js";

/** A real YYYY-MM-DD that is not in the future (one day of slack for time zones). */
export const visitDate = z.iso.date().refine((d) => d <= tomorrow(), "date is in the future");

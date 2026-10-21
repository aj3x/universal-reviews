import { useCallback, useEffect, useRef, useState } from "react";
import type { Page, Review } from "./api";

export type LoadPage = (cursor?: string) => Promise<Page>;

/**
 * Cursor-paged list. `key` identifies what is being listed: when it changes the list resets.
 * `load` may be a fresh closure on every render; only `key` decides when to refetch.
 */
export function usePaged(key: string, load: LoadPage) {
  const [rows, setRows] = useState<Review[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const latest = useRef(0); // a slow response for an old key or page must not overwrite a newer one
  const loader = useRef(load);
  loader.current = load;

  const more = useCallback(async (cursor?: string | null) => {
    const mine = ++latest.current;
    setState("loading");
    try {
      const p = await loader.current(cursor ?? undefined);
      if (mine !== latest.current) return;
      setRows((r) => (cursor ? [...r, ...p.data] : p.data));
      setNext(p.nextCursor);
      setState("ready");
    } catch {
      if (mine === latest.current) setState("error");
    }
  }, [key]); // `load` is read through a ref, so only `key` should trigger a reload

  useEffect(() => {
    setRows([]);
    setNext(null);
    void more();
  }, [more]);
  return { rows, next, state, more };
}

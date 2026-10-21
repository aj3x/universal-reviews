import { useCallback, useEffect, useRef, useState } from "react";
import { api, type Page, type Review } from "./api";

export function usePaged(path: string) {
  const [rows, setRows] = useState<Review[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const latest = useRef(0); // a slow response for an old path or page must not overwrite a newer one

  const more = useCallback(async (cursor?: string | null) => {
    const mine = ++latest.current;
    setState("loading");
    try {
      const sep = path.includes("?") ? "&" : "?";
      const p = await api<Page<Review>>(`${path}${cursor ? `${sep}cursor=${cursor}` : ""}`);
      if (mine !== latest.current) return;
      setRows((r) => (cursor ? [...r, ...p.data] : p.data));
      setNext(p.nextCursor);
      setState("ready");
    } catch {
      if (mine === latest.current) setState("error");
    }
  }, [path]);

  useEffect(() => {
    setRows([]);
    setNext(null);
    void more();
  }, [more]);
  return { rows, next, state, more };
}

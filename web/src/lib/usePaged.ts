import { useCallback, useEffect, useState } from "react";
import { api, type Page, type Review } from "./api";

export function usePaged(path: string) {
  const [rows, setRows] = useState<Review[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  const more = useCallback(async (cursor?: string | null) => {
    setState("loading");
    try {
      const sep = path.includes("?") ? "&" : "?";
      const p = await api<Page<Review>>(`${path}${cursor ? `${sep}cursor=${cursor}` : ""}`);
      setRows((r) => (cursor ? [...r, ...p.data] : p.data));
      setNext(p.nextCursor);
      setState("ready");
    } catch {
      setState("error");
    }
  }, [path]);
  useEffect(() => void more(), [more]);
  return { rows, next, state, more };
}

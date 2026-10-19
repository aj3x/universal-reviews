import { useEffect, useState } from "react";

export /** Hash routing: no dependency, deep links work, back button works. */
function useRoute() {
  const [hash, setHash] = useState(location.hash.slice(1) || "/");
  useEffect(() => {
    const on = () => setHash(location.hash.slice(1) || "/");
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  return hash.split("?")[0]!.split("/").filter(Boolean);
}

import { useEffect, useState } from "react";

/** Hash routes: `#/<page>?<params>`. Pages read their filters from the params, so links can be shared. */
export interface Route {
  readonly page: string;
  readonly params: URLSearchParams;
}

export function parseHash(hash: string): Route {
  const [path = "", query = ""] = hash.replace(/^#\/?/, "").split("?", 2);
  return { page: path || "overview", params: new URLSearchParams(query) };
}

export function href(
  page: string,
  params: Record<string, string | number | null | undefined> = {},
): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== "") query.set(key, String(value));
  }
  const text = query.toString();
  return `#/${page}${text ? `?${text}` : ""}`;
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(window.location.hash));
  useEffect(() => {
    const onChange = () => {
      setRoute(parseHash(window.location.hash));
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

/** Replaces some params on the current page without a new history entry per keystroke. */
export function setParams(route: Route, changes: Record<string, string | null>): void {
  const next = new URLSearchParams(route.params);
  for (const [key, value] of Object.entries(changes)) {
    if (value === null || value === "") next.delete(key);
    else next.set(key, value);
  }
  const text = next.toString();
  window.history.replaceState(null, "", `#/${route.page}${text ? `?${text}` : ""}`);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}

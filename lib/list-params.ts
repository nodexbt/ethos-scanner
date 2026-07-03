import type { ListParams, SortField } from "@/lib/db/investigations";

const SORT_FIELDS: SortField[] = ["recent", "strong", "possible", "score"];

/** Parse the shared scan-list search/sort/filter params from a query string. */
export function parseListParams(sp: URLSearchParams): ListParams {
  const sortRaw = sp.get("sort");
  const sort = SORT_FIELDS.includes(sortRaw as SortField) ? (sortRaw as SortField) : undefined;
  const dir = sp.get("dir") === "asc" ? "asc" : sp.get("dir") === "desc" ? "desc" : undefined;
  const num = (v: string | null): number | null => {
    if (v === null || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  return {
    search: sp.get("search")?.trim() || undefined,
    sort,
    dir,
    flaggedOnly: sp.get("flagged") === "1",
    minScore: num(sp.get("minScore")),
    maxScore: num(sp.get("maxScore")),
  };
}

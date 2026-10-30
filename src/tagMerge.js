// Replace every tag in `sources` with `target` in one contact's tag list.
// Keeps the order of the first appearance, drops duplicates, leaves other
// tags untouched. Returns the same array when nothing needs changing.
export function mergeTagNames(tags, sources, target) {
  const list = Array.isArray(tags) ? tags : [];
  if (!list.some((t) => sources.includes(t))) return list;
  const out = [];
  for (const t of list) {
    const next = sources.includes(t) ? target : t;
    if (!out.includes(next)) out.push(next);
  }
  return out;
}

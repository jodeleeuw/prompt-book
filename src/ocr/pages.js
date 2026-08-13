// Turning a stack of photographed pages into one script.
//
// Page furniture is the tax on scanning: numbers, running headers, CONTINUED
// markers, and a speech that breaks across a page and repeats its cue with
// (CONT'D). None of it is dialogue, and all of it reaches the parser as if it
// were.

const PAGE_NUMBER = /^[([]?\s*(?:page\s*)?\d{1,4}\s*[.)\]]?$/i;
const CONTINUED = /^[([]?\s*(?:continued|cont(?:'|’)?d|more)\s*[.:)\]]?$/i;

const normalise = (line) =>
  line
    .toLowerCase()
    .replace(/\d+/g, '#') // page numbers vary; the rest of a running head does not
    .replace(/[^a-z#]+/g, ' ')
    .trim();

/**
 * A header or footer is a first or last line that repeats across pages.
 * One page cannot tell you what is furniture, so this needs three or more.
 */
function repeatedEdges(pages) {
  if (pages.length < 3) return new Set();

  const tally = (pick) => {
    const counts = new Map();
    for (const page of pages) {
      const line = pick(page.filter((l) => l.trim()));
      if (!line) continue;
      const key = normalise(line);
      if (key.length < 3) continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  };

  const threshold = Math.max(3, Math.ceil(pages.length * 0.6));
  const repeated = new Set();
  for (const counts of [tally((l) => l[0]), tally((l) => l[l.length - 1])]) {
    for (const [key, count] of counts) if (count >= threshold) repeated.add(key);
  }
  return repeated;
}

const cueOf = (line) => {
  const match = line.trim().match(/^([A-Z][A-Z .'’-]{0,38})\s*\((?:cont(?:'|’)?d|continued)\)\s*:?$/i);
  return match ? match[1].trim().replace(/\s+/g, ' ') : null;
};

/**
 * @param pageTexts string[] — one per photographed page, in order
 * @returns {{ text: string, dropped: string[] }} the script, and what was removed
 */
export function joinPages(pageTexts) {
  const pages = pageTexts.map((text) => text.split('\n'));
  const furniture = repeatedEdges(pages);
  const dropped = [];

  const cleaned = pages.map((lines) => {
    const kept = [];
    lines.forEach((line, i) => {
      const trimmed = line.trim();
      const nearEdge = i < 2 || i >= lines.length - 2;

      if (!trimmed) {
        kept.push('');
        return;
      }
      if (nearEdge && PAGE_NUMBER.test(trimmed)) return dropped.push(trimmed);
      if (CONTINUED.test(trimmed)) return dropped.push(trimmed);
      if (nearEdge && furniture.has(normalise(trimmed))) return dropped.push(trimmed);
      kept.push(line);
    });
    // Trim blank lines from both ends so pages join without gaps.
    while (kept.length && !kept[0].trim()) kept.shift();
    while (kept.length && !kept[kept.length - 1].trim()) kept.pop();
    return kept;
  });

  const out = [];
  for (const page of cleaned) {
    let lines = page;
    if (!lines.length) continue;

    // A speech split across a page break repeats its cue with (CONT'D). The
    // dialogue below it belongs to the speech above, not to a new one — so the
    // repeated cue goes, and no blank line separates them.
    const continuing = out.length > 0 && cueOf(lines[0]);
    if (continuing) {
      dropped.push(lines[0].trim());
      lines = lines.slice(1);
      while (lines.length && !lines[0].trim()) lines.shift();
    } else if (out.length) {
      out.push('');
    }
    out.push(...lines);
  }

  return { text: out.join('\n'), dropped };
}

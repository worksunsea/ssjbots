// Rapaport PDF content classification. File names are never trusted: a PDF is
// "round", "pear/fancy" or "combined" purely by what is printed inside it.

const HEADER_RE = /RAPAPORT\s*:\s*\(\s*\.?\d+\.?\d*\s*[-–—]\s*\.?\d+\.?\d*\s*CT/i;

/**
 * Splits extracted PDF text into the round and pear/fancy price sections.
 * Handles: combined "All Rapaport Price Lists" PDF (rounds, then pears, then
 * parcel prices), or a single-kind Round or Pear PDF.
 * @param {string|null} text pdf-parse output
 * @returns {{ rounds: string|null, fancy: string|null }}
 */
export function splitRapText(text) {
  if (!text) return { rounds: null, fancy: null };

  // Parcel (small-stone $/ct) pages follow the grids in the combined PDF — not used.
  const parcelIdx = text.search(/Parcel Prices/i);
  const body = parcelIdx >= 0 ? text.slice(0, parcelIdx) : text;

  const pearIdx = body.search(/PEAR SHAPES/i);
  const head = pearIdx >= 0 ? body.slice(0, pearIdx) : body;
  const tail = pearIdx >= 0 ? body.slice(pearIdx) : "";

  const looksRound = (t) => /ROUNDS/.test(t) && HEADER_RE.test(t);
  const looksPear = (t) => /PEARS/.test(t) && HEADER_RE.test(t);

  return {
    rounds: looksRound(head) ? head : null,
    fancy: looksPear(tail) ? tail : (pearIdx < 0 && looksPear(head) && !looksRound(head) ? head : null),
  };
}

export const MAX_SEGMENT = 900;
export const MAX_TOTAL_CHARS = 120000;
export const BATCH_CHARS = 9000;

/** Metni numaralı segmentlere böler. Alıntı doğrulaması bu segmentlerin ORİJİNAL metnine karşı yapılır. */
export function segmentText(text) {
  const paras = text.split(/\n+/).map(s => s.trim()).filter(s => s.length > 0);
  const out = [];
  let id = 0, total = 0, truncated = false;
  for (const p of paras) {
    const pieces = [];
    if (p.length <= MAX_SEGMENT) pieces.push(p);
    else {
      const sents = p.match(/[^.!?;]+[.!?;]+["')\]]*\s*|[^.!?;]+$/gu) || [p];
      let cur = '';
      for (const s of sents) {
        if ((cur + s).length > MAX_SEGMENT && cur) { pieces.push(cur.trim()); cur = ''; }
        cur += s;
        while (cur.length > MAX_SEGMENT) { pieces.push(cur.slice(0, MAX_SEGMENT)); cur = cur.slice(MAX_SEGMENT); }
      }
      if (cur.trim()) pieces.push(cur.trim());
    }
    for (const piece of pieces) {
      if (total + piece.length > MAX_TOTAL_CHARS) { truncated = true; break; }
      out.push({ id: id++, text: piece });
      total += piece.length;
    }
    if (truncated) break;
  }
  const sourceChars = paras.reduce((n, p) => n + p.length, 0);   // satır sonları sayılmaz: kapsam yüzdesi gerçekçi olsun
  return { segments: out, truncated, totalChars: total, sourceChars };
}

export function batchSegments(segments, limit = BATCH_CHARS) {
  const batches = []; let cur = [], n = 0;
  for (const s of segments) {
    if (n + s.text.length > limit && cur.length) { batches.push(cur); cur = []; n = 0; }
    cur.push(s); n += s.text.length;
  }
  if (cur.length) batches.push(cur);
  return batches;
}

// Prompt-injection savunması: (1) gizli metni çıkarma (extract.js), (2) talimat benzeri metni tespit + sansürleme,
// (3) LLM'e hiçbir yetki vermeme: skor ve karar kodda hesaplanır.

const PATTERNS = [
  /ignore (all |any |the )?(previous|prior|above|earlier) (instructions|prompts?|rules)/iu,
  /disregard (all |any |the )?(previous|prior|above|earlier|your) /iu,
  /(forget|override|bypass) (all |your |the )?(previous |prior )?(instructions|rules|guidelines|system prompt)/iu,
  /(system|developer) (prompt|message|instruction)/iu,
  /you are (now |no longer )?(an? )?(ai|assistant|language model|chatgpt|claude|gpt)/iu,
  /(as|if you are) an? (ai|llm|language model|assistant)/iu,
  /(set|report|rate|mark|output|return|give)( this| the)?( document| page| site| policy)? (as |the )?(risk|score|rating|verdict)?.{0,30}(safe|0\/100|zero|no risk|low risk|güvenli)/iu,
  /(do not|don't|never) (report|flag|mention|list) (any )?(risk|finding|clause|issue)/iu,
  /(report|return|output) (an )?empty (findings|list|array)/iu,
  /\bAI (agents?|models?|assistants?|reviewers?)\b.{0,40}(must|should|shall|please|now)/iu,
  /(önceki|yukar[ıi]daki|tüm) (talimat|komut|kural)\w* (yok say|unut|göz ard[ıi])/iu,
  /(talimat|komut)\w* (yok say|unut)/iu,
  /(risk|puan|skor)\w* .{0,25}(0|s[ıi]f[ıi]r|düşük|güvenli) (olarak )?(işaretle|bildir|ver|yaz)/iu,
  /yapay zek[aâ]\w* .{0,40}(mutlaka|şunu yap|yapmal[ıi]s[ıi]n)/iu,
  /<\|?(im_start|im_end|system|assistant)\|?>/iu,
  /^\s*(system|assistant|developer)\s*:/imu,
];

export const REDACTION = '[ŞÜPHELİ_TALİMAT_ÇIKARILDI]';

/** Bir metinde talimat benzeri kalıp var mı? Sansürlü kopyayı ve bulguları döndürür. */
export function scanInjection(text) {
  const hits = [];
  let redacted = text;
  for (const re of PATTERNS) {
    const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
    redacted = redacted.replace(g, m => { hits.push(m.trim().slice(0, 200)); return REDACTION; });
  }
  return { hits, redacted };
}

/** Sayfa gerçekten bir hukuki metin mi? (LLM'e sormadan, ucuz ön kontrol) */
export function legalScore(text) {
  const t = text.toLocaleLowerCase('tr');
  const words = ['terms', 'privacy', 'policy', 'agreement', 'liability', 'personal data', 'cookies', 'subscription', 'governing law',
    'kullanım koşul', 'gizlilik', 'kişisel veri', 'aydınlatma', 'sözleşme', 'abonelik', 'sorumluluk', 'çerez', 'kvkk', 'şartlar'];
  let n = 0; for (const w of words) if (t.includes(w)) n++;
  return n;
}

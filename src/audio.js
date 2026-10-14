// Apple-vari kısa "earcon"lar (WebAudio ile üretilir, dosya yok) + isteğe bağlı Türkçe sesli okuma.
// Her sonuç ayrı bir ses imzasına sahip: ses tek başına bilgi taşır, ama renk/ekran olmadan da anlaşılır.
let ctx;
const ac = () => (ctx ||= new (window.AudioContext || window.webkitAudioContext)());

function tone(freq, start, dur, { type = 'sine', gain = 0.16, volume = 1 } = {}) {
  const c = ac(), o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.value = freq;
  const t0 = c.currentTime + start;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain * volume), t0 + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(c.destination);
  o.start(t0); o.stop(t0 + dur + 0.05);
}

const SIGNATURES = {
  // yumuşak yükselen iki nota: "tamam"
  safe: v => { tone(659.25, 0, 0.32, { volume: v }); tone(987.77, 0.11, 0.5, { volume: v }); },
  // iki kısa, orta perdeden üçgen dalga: "bir bakın"
  caution: v => { tone(440, 0, 0.18, { type: 'triangle', gain: 0.2, volume: v }); tone(440, 0.24, 0.18, { type: 'triangle', gain: 0.2, volume: v }); },
  // alçalan, daha derin üç nota: "durun"
  high: v => { tone(392, 0, 0.22, { type: 'triangle', gain: 0.24, volume: v }); tone(311.13, 0.2, 0.22, { type: 'triangle', gain: 0.24, volume: v }); tone(233.08, 0.4, 0.4, { type: 'triangle', gain: 0.24, volume: v }); },
  // soru gibi yükselen, yarım kalan ton: "emin değilim"
  uncertain: v => { tone(392, 0, 0.2, { volume: v, gain: 0.13 }); tone(466.16, 0.22, 0.45, { volume: v, gain: 0.13 }); },
};

export function playEarcon(verdict, volume = 0.8) {
  const c = ac(); if (c.state === 'suspended') c.resume();
  (SIGNATURES[verdict] || SIGNATURES.uncertain)(volume);
}

export function speak(text, { rate = 0.95, volume = 1 } = {}) {
  if (!('speechSynthesis' in window)) return false;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'tr-TR'; u.rate = rate; u.volume = volume;
  const v = speechSynthesis.getVoices().find(x => x.lang?.toLowerCase().startsWith('tr'));
  if (v) u.voice = v;
  speechSynthesis.speak(u);
  return true;
}
export function stopSpeaking() { if ('speechSynthesis' in window) speechSynthesis.cancel(); }

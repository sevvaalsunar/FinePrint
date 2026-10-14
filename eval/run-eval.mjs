// Mini eval: gerçek ToS metinleri üzerinde yakalanan / kaçırılan / yanlış alarm.
//   node eval/run-eval.mjs --mode rules                 (LLM'siz taban çizgisi)
//   LLM_BASE_URL=... LLM_MODEL=... LLM_API_KEY=... node eval/run-eval.mjs --mode llm
// Veri: eval/corpus/<ad>.txt (düz metin) + eval/corpus/<ad>.gold.json
//   gold: [{"category":"arbitration_waiver","contains":"metinde geçen ayırt edici ifade"}]
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { analyze } from '../src/pipeline.js';
import { directTransport } from '../src/llm.js';
import { norm } from '../src/schema.js';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > -1 ? process.argv[i + 1] : d; };
const dir = arg('dir', 'eval/corpus'), mode = arg('mode', 'rules');
const settings = { baseURL: process.env.LLM_BASE_URL, model: process.env.LLM_MODEL, apiKey: process.env.LLM_API_KEY };
if (mode === 'llm' && !(settings.baseURL && settings.model && settings.apiKey)) { console.error('LLM_BASE_URL, LLM_MODEL, LLM_API_KEY gerekli.'); process.exit(1); }

const docs = readdirSync(dir).filter(f => f.endsWith('.txt')).sort();
if (!docs.length) { console.error(`${dir} içinde .txt yok. README'deki "Eval verisi" bölümüne bakın.`); process.exit(1); }

const rows = []; const detail = [];
for (const f of docs) {
  const name = f.replace(/\.txt$/, '');
  const text = readFileSync(join(dir, f), 'utf8');
  const gold = JSON.parse(readFileSync(join(dir, name + '.gold.json'), 'utf8'));
  const ex = { text, charCount: text.length, hiddenChars: 0, hiddenSamples: [], url: name, title: name };
  const r = await analyze(ex, { settings, transport: mode === 'llm' ? directTransport(settings) : null, useLLM: mode === 'llm' });
  const hit = new Set(); const falseAlarms = [];
  for (const fd of r.findings) {
    const q = norm(fd.quote);
    const gi = gold.findIndex((g, i) => g.category === fd.category && (q.includes(norm(g.contains)) || norm(g.contains).includes(q)));
    if (gi >= 0) hit.add(gi); else falseAlarms.push(fd);
  }
  const missed = gold.filter((_, i) => !hit.has(i));
  rows.push({ name, gold: gold.length, caught: hit.size, missed: missed.length, falseAlarm: falseAlarms.length, blocked: r.rejected.length, uncertain: r.uncertain.length, verdict: r.verdict, score: r.score });
  detail.push({ name, missed, falseAlarms: falseAlarms.map(x => ({ category: x.category, quote: x.quote, source: x.source })) });
}
const sum = k => rows.reduce((n, r) => n + r[k], 0);
const rec = sum('caught') / Math.max(1, sum('gold')), prec = sum('caught') / Math.max(1, sum('caught') + sum('falseAlarm'));
let md = `# Eval sonucu (${mode}, ${new Date().toISOString().slice(0, 10)})\n\n| Belge | Etiketli | Yakalanan | Kaçırılan | Yanlış alarm | Doğrulayıcının attığı | Karar | Skor |\n|---|---|---|---|---|---|---|---|\n`;
for (const r of rows) md += `| ${r.name} | ${r.gold} | ${r.caught} | ${r.missed} | ${r.falseAlarm} | ${r.blocked} | ${r.verdict} | ${r.score} |\n`;
md += `\n**Toplam:** yakalama (recall) ${(rec * 100).toFixed(0)}%, kesinlik (precision) ${(prec * 100).toFixed(0)}%\n\n## Kaçırılanlar ve yanlış alarmlar\n`;
for (const d of detail) {
  md += `\n### ${d.name}\n`;
  for (const m of d.missed) md += `- KAÇIRILDI [${m.category}] “${m.contains}”\n`;
  for (const a of d.falseAlarms) md += `- YANLIŞ ALARM [${a.category}] (${a.source}) “${a.quote.slice(0, 160)}”\n`;
}
console.log(md);
writeFileSync(join('eval', `results-${mode}.md`), md);

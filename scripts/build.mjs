import { build } from 'esbuild';
import { writeFileSync } from 'node:fs';
// Kullanıcı hiçbir anahtar görmez. Geliştirici derleme sırasında bir kez verir:
//   LLM_BASE_URL=https://api.openai.com/v1 LLM_MODEL=gpt-4o-mini LLM_API_KEY=sk-... npm run build
// Verilmezse uzantı "hızlı tarama" (yalnızca kurallar) ile yine otomatik çalışır.
const cfg = { baseURL: process.env.LLM_BASE_URL || '', model: process.env.LLM_MODEL || '', apiKey: process.env.LLM_API_KEY || '' };
writeFileSync('config.js', `// otomatik üretilir (scripts/build.mjs). Git'e eklenmez.\nexport const LLM = ${JSON.stringify(cfg)};\n`);
console.log(cfg.apiKey ? 'LLM yapılandırıldı: ' + cfg.model : 'LLM yok: yalnızca kurallarla hızlı tarama');
await build({ entryPoints: ['src/agent-entry.js'], bundle: true, format: 'iife', outfile: 'vendor/agent.js', minify: true, target: 'chrome120', logLevel: 'warning' });

import { playEarcon } from './audio.js';
chrome.runtime.onMessage.addListener(m => { if (m?.type === 'earcon') playEarcon(m.verdict, m.volume ?? 0.8); });

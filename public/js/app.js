/** Titik masuk: nyalakan router, pantau kuota API Buffer. */
import { startRouter } from './router.js';
import * as api from './api.js';

startRouter();

// ---------- indikator kuota API Buffer ----------
// Paket Free cuma 250 request/hari, jadi angkanya ditampilkan terus terang
// supaya tidak kaget kalau pengiriman jadwal tiba-tiba ditolak.
const box = document.getElementById('usageBox');
const fill = document.getElementById('usageFill');
const num = document.getElementById('usageNum');

async function refreshUsage() {
  try {
    const u = await api.getUsage();
    if (!u || u.dayLimit == null) return;
    const pct = Math.min(100, (u.dayCount / u.dayLimit) * 100);
    fill.style.width = `${pct}%`;
    fill.className = `usage-fill${pct > 90 ? ' full' : pct > 70 ? ' hot' : ''}`;
    num.textContent = `${u.dayCount} / ${u.dayLimit} request`;
    box.hidden = false;
  } catch {
    box.hidden = true;
  }
}

refreshUsage();
// Angkanya berubah tiap kali ada panggilan ke Buffer, jadi disegarkan berkala.
setInterval(refreshUsage, 20000);
window.addEventListener('hashchange', refreshUsage);
document.addEventListener('buffer-usage-changed', refreshUsage);

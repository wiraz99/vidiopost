/** Titik masuk: muat grup, nyalakan router, pantau kuota API Buffer. */
import { startRouter } from './router.js';
import * as api from './api.js';
import * as grup from './grup.js';

// ---------- grup aktif ----------
// Dimuat SEBELUM router jalan: halaman pertama pun harus sudah tahu grupnya,
// kalau tidak, sekejap isi grup bawaan tampil sebelum diganti.
const markSide = document.getElementById('grupMarkSide');
const markTop = document.getElementById('grupMarkTop');
const pilihan = [document.getElementById('grupSidebar'), document.getElementById('grupTopbar')];

function gambarPenukar() {
  const daftar = grup.semua();
  const aktif = grup.grupAktif();

  for (const sel of pilihan) {
    if (!sel) continue;
    sel.innerHTML = '';
    for (const g of daftar) {
      const opt = document.createElement('option');
      opt.value = g.id;
      opt.textContent = g.name;
      sel.append(opt);
    }
    sel.value = grup.idAktif();
    sel.onchange = () => grup.setAktif(sel.value);
  }

  // Warna & huruf penanda ikut grupnya — pembeda tercepat tanpa membaca teks.
  for (const mark of [markSide, markTop]) {
    if (!mark) continue;
    mark.textContent = (aktif?.name || 'A').trim().charAt(0).toUpperCase();
    mark.style.background = aktif?.warna || '';
  }

  document.title = `${aktif?.name || 'Video Post'} — Video Post`;
}

let router = null;

async function muatGrup() {
  try {
    grup.terima(await api.listGroups());
  } catch {
    // Grup gagal dimuat bukan alasan untuk memblokir seluruh aplikasi;
    // server tetap memakai grup bawaan kalau kita tidak menyebut apa-apa.
    grup.terima({ groups: [], bawaanId: '' });
  }
  gambarPenukar();
}

document.addEventListener('grup-berubah', () => {
  gambarPenukar();
  router?.rerender();
});

await muatGrup();
router = startRouter();

// Grup bisa dibuat/dihapus dari halaman Pengaturan; penukarnya ikut disegarkan.
document.addEventListener('grup-diubah', muatGrup);

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

// ---------- keluar ----------
document.getElementById('logoutBtn').onclick = async () => {
  try {
    await api.logout();
  } catch {
    // Gagal pun tetap diantar ke halaman masuk — cookienya sudah tidak dipakai.
  }
  location.href = '/login';
};

refreshUsage();
// Angkanya berubah tiap kali ada panggilan ke Buffer, jadi disegarkan berkala.
setInterval(refreshUsage, 20000);
window.addEventListener('hashchange', refreshUsage);
document.addEventListener('buffer-usage-changed', refreshUsage);

import { metaFor } from './config.js';

/** Bikin elemen: el('div', 'kelas', 'teks') */
export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

/** el() + isi HTML mentah. Hanya untuk markup yang KITA yang bikin. */
export function html(tag, className, markup) {
  const node = el(tag, className);
  node.innerHTML = markup;
  return node;
}

export const escapeHtml = (s = '') =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const qs = (sel, root = document) => root.querySelector(sel);
export const qsa = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Lencana bulat kecil berisi inisial platform. */
export function platformDot(platform) {
  const meta = metaFor(platform);
  const dot = el('span', 'pdot', meta.icon);
  dot.style.background = meta.color;
  dot.title = meta.name;
  return dot;
}

export function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`;
}

export function formatDate(iso, withTime = true) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString('id-ID', {
    day: '2-digit', month: 'short', year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {})
  });
}

/** '2026-08-20' → 'Kam, 20 Agu' */
export function formatDayLabel(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('id-ID', { weekday: 'short', day: '2-digit', month: 'short' });
}

export const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const formatNumber = (n) => Number(n || 0).toLocaleString('id-ID');

/** Toast pojok layar. Dipakai untuk semua notifikasi sukses/gagal. */
export function toast(message, kind = '') {
  const wrap = document.getElementById('toasts');
  if (!wrap) return;
  const node = el('div', `toast ${kind}`, message);
  wrap.append(node);
  setTimeout(() => {
    node.style.transition = 'opacity .3s';
    node.style.opacity = '0';
    setTimeout(() => node.remove(), 300);
  }, kind === 'bad' ? 6000 : 3200);
}

/** Tandai tombol sedang bekerja, kembalikan fungsi untuk memulihkannya. */
export function busy(button, label = 'Memproses…') {
  const original = button.innerHTML;
  const wasDisabled = button.disabled;
  button.disabled = true;
  button.innerHTML = `<span class="spin"></span> ${escapeHtml(label)}`;
  return () => {
    button.innerHTML = original;
    button.disabled = wasDisabled;
  };
}

/** Tunggu sebentar — dipakai untuk memberi jeda antar request ke Buffer. */
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Jalankan fn setelah user berhenti mengetik. */
export function debounce(fn, wait = 500) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

/** Pasang penghitung karakter pada textarea/input sesuai batas platform. */
export function attachCounter(input, counter, limits) {
  const sync = () => {
    const n = input.value.length;
    counter.textContent = `${n} / ${limits.hard} karakter`;
    counter.className = `count${n > limits.hard ? ' count-bad' : n > limits.soft ? ' count-warn' : ''}`;
  };
  input.addEventListener('input', sync);
  sync();
  return sync;
}

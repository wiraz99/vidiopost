/**
 * Set ikon SVG garis (stroke), 24x24, mewarisi warna teks lewat currentColor.
 *
 * Alasan tidak pakai emoji: tiap HP/OS merendernya beda-beda, ukurannya tidak
 * konsisten, dan hasilnya terlihat kurang serius. SVG ditanam langsung di file
 * ini supaya tidak butuh internet dan tidak ada request tambahan.
 */

const PATHS = {
  // navigasi
  video:    '<path d="m22 8-6 4 6 4V8Z"/><rect x="2" y="6" width="14" height="12" rx="2"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  hash:     '<path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18"/>',
  chart:    '<path d="M3 3v18h18M8 17v-5M13 17V8M18 17v-4"/>',
  clock:    '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 9 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 9a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z"/>',
  bolt:     '<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z"/>',

  // aksi
  sparkles: '<path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/><path d="M19 16v3M17.5 17.5h3"/>',
  eye:      '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff:   '<path d="M10.7 5.1A10.4 10.4 0 0 1 12 5c6.5 0 10 7 10 7a17.8 17.8 0 0 1-2.9 3.9M6.3 6.3A17.4 17.4 0 0 0 2 12s3.5 7 10 7a10 10 0 0 0 4.6-1.1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/><path d="m2 2 20 20"/>',
  trash:    '<path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
  refresh:  '<path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/>',
  send:     '<path d="M22 2 11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7Z"/>',
  plus:     '<path d="M12 5v14M5 12h14"/>',
  check:    '<path d="m5 13 4 4L19 7"/>',
  x:        '<path d="M18 6 6 18M6 6l12 12"/>',
  alert:    '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/>',
  info:     '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  link:     '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
  upload:   '<path d="M12 14V4M8 8l4-4 4 4"/><path d="M20 15v3a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-3"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  chevronUp:   '<path d="m18 15-6-6-6 6"/>',
  arrowRight:  '<path d="M5 12h14M13 6l6 6-6 6"/>',
  arrowLeft:   '<path d="M19 12H5M11 18l-6-6 6-6"/>',
  dot:      '<circle cx="12" cy="12" r="2.5"/>',

  // butir bertitik enam untuk pegangan geser
  grip:     '<circle cx="9" cy="5" r="1.4"/><circle cx="9" cy="12" r="1.4"/><circle cx="9" cy="19" r="1.4"/><circle cx="15" cy="5" r="1.4"/><circle cx="15" cy="12" r="1.4"/><circle cx="15" cy="19" r="1.4"/>'
};

// Ikon ini digambar penuh, bukan garis.
const FILLED = new Set(['grip', 'dot']);

/** String SVG siap tempel ke innerHTML. */
export function iconSvg(name, size = 18) {
  const paths = PATHS[name];
  if (!paths) return '';
  const filled = FILLED.has(name);
  return `<svg class="ico" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true" ` +
    `fill="${filled ? 'currentColor' : 'none'}" stroke="${filled ? 'none' : 'currentColor'}" ` +
    `stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
}

/** Elemen SVG siap di-append. */
export function icon(name, size = 18) {
  const wrap = document.createElement('span');
  wrap.className = 'ico-wrap';
  wrap.innerHTML = iconSvg(name, size);
  return wrap.firstElementChild || wrap;
}

export const hasIcon = (name) => !!PATHS[name];

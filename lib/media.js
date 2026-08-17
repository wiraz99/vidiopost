/**
 * Alamat file media.
 *
 * URL absolut TIDAK disimpan permanen di videos.json. Dulu disimpan, dan
 * akibatnya kalau PUBLIC_BASE_URL salah waktu upload, URL yang salah itu
 * ikut terkunci di data selamanya — mengubah environment variable pun tidak
 * memperbaiki video yang sudah terlanjur masuk.
 *
 * Sekarang yang disimpan hanya nama file; alamatnya dihitung ulang tiap kali
 * dibaca. Browser dikasih path relatif (tidak peduli PUBLIC_BASE_URL sama
 * sekali), sedangkan Buffer dikasih URL absolut karena dia mengunduh dari luar.
 */
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const store = require('./store');

const PORT = process.env.PORT || 3000;
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`).replace(/\/+$/, '');

/** URL absolut — dipakai Buffer untuk mengunduh videonya. */
const publicUrl = (filename) => (filename ? `${PUBLIC_BASE_URL}/media/${filename}` : '');

/** Path relatif — dipakai browser, kebal terhadap salah setelan PUBLIC_BASE_URL. */
const mediaPath = (filename) => (filename ? `/media/${filename}` : '');

/** Apakah filenya masih benar-benar ada di disk. */
function fileExists(filename) {
  if (!filename) return false;
  const base = path.resolve(store.MEDIA_DIR);
  const target = path.resolve(base, filename);
  if (!target.startsWith(base + path.sep)) return false;
  return fs.existsSync(target);
}

/** Lengkapi objek video dengan alamat terkini + status filenya. */
const decorate = (video) => ({
  ...video,
  url: publicUrl(video.filename),
  path: mediaPath(video.filename),
  exists: fileExists(video.filename)
});

/** PUBLIC_BASE_URL yang jelas tidak bisa dijangkau dari luar. */
const baseUrlLooksLocal = () => /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)/i.test(PUBLIC_BASE_URL);

// Hasil pemeriksaan disimpan sebentar: satu jadwal bisa mengirim 60 post,
// dan memeriksa URL yang sama 60 kali cuma memperlambat tanpa guna.
const CHECK_TTL_MS = 5 * 60 * 1000;
const checkCache = new Map();

/**
 * Uji apakah video benar-benar bisa diunduh dari PUBLIC_BASE_URL.
 *
 * Buffer mengunduh videonya sendiri dari URL itu. Kalau gagal, errornya
 * "Invalid post: Video could not be read from its URL." — dan itu baru
 * ketahuan setelah kuota Buffer terpakai. Jadi diperiksa lebih dulu.
 */
async function checkPublicUrl(filename, { force = false } = {}) {
  const cached = checkCache.get(filename);
  if (!force && cached && Date.now() - cached.at < CHECK_TTL_MS) return cached.result;

  const url = publicUrl(filename);
  const base = {
    url,
    filename,
    adaDiDisk: fileExists(filename),
    baseUrlTerlihatLokal: baseUrlLooksLocal()
  };

  let result;
  if (!filename) {
    result = { ...base, ok: false, reason: 'Video ini tidak punya nama file.' };
  } else if (!base.adaDiDisk) {
    result = { ...base, ok: false, reason: 'File tidak ada di disk server. Volume penyimpanan kemungkinan tidak ter-mount ke MEDIA_DIR.' };
  } else if (base.baseUrlTerlihatLokal) {
    result = { ...base, ok: false, reason: `PUBLIC_BASE_URL berisi alamat lokal (${PUBLIC_BASE_URL}) — mustahil dijangkau Buffer dari internet.` };
  } else {
    try {
      // Minta 1KB pertama saja: cukup membuktikan URL-nya bisa diakses publik
      // tanpa mengunduh seluruh video.
      const probe = await fetch(url, { headers: { Range: 'bytes=0-1023' }, redirect: 'follow' });
      const contentType = probe.headers.get('content-type');
      const info = {
        ...base,
        status: probe.status,
        contentType,
        acceptRanges: probe.headers.get('accept-ranges'),
        contentLength: probe.headers.get('content-length')
      };

      if (probe.status === 401 || probe.status === 403) {
        result = { ...info, ok: false, reason: `URL dilindungi (HTTP ${probe.status}). Buffer tidak bisa mengunduhnya — matikan proteksi/basic-auth untuk path /media.` };
      } else if (probe.status >= 400) {
        result = { ...info, ok: false, reason: `URL membalas HTTP ${probe.status}. Periksa PUBLIC_BASE_URL.` };
      } else if (!/^video\//i.test(contentType || '')) {
        result = { ...info, ok: false, reason: `Yang terbuka bukan file video (Content-Type "${contentType}"). Kemungkinan halaman login, halaman error, atau domainnya salah.` };
      } else {
        result = { ...info, ok: true, reason: 'Video bisa diunduh dari luar.' };
      }
    } catch (err) {
      result = { ...base, ok: false, reason: `Tidak bisa menghubungi ${url} — ${err.message}` };
    }
  }

  checkCache.set(filename, { at: Date.now(), result });
  return result;
}

module.exports = {
  PUBLIC_BASE_URL,
  publicUrl,
  mediaPath,
  fileExists,
  decorate,
  baseUrlLooksLocal,
  checkPublicUrl
};

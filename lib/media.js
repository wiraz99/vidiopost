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

module.exports = { PUBLIC_BASE_URL, publicUrl, mediaPath, fileExists, decorate, baseUrlLooksLocal };

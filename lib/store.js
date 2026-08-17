/**
 * Penyimpanan data sederhana berbasis file JSON.
 * Sengaja bukan database — datanya kecil dan cuma dipakai satu orang.
 */
const fs = require('fs');
const path = require('path');

const MEDIA_DIR = process.env.MEDIA_DIR || path.join(__dirname, '..', 'media');
// Default di dalam MEDIA_DIR supaya ikut terbawa persistent volume Coolify.
const DATA_DIR = process.env.DATA_DIR || path.join(MEDIA_DIR, '_data');

if (!fs.existsSync(MEDIA_DIR)) fs.mkdirSync(MEDIA_DIR, { recursive: true });
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const fileOf = (name) => path.join(DATA_DIR, `${name}.json`);

function read(name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(fileOf(name), 'utf8'));
  } catch {
    return fallback;
  }
}

/** Tulis atomik: tulis ke .tmp lalu rename, supaya file tidak pernah setengah jadi. */
function write(name, data) {
  const target = fileOf(name);
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, target);
  return data;
}

/** Baca, ubah lewat callback, tulis balik. Mengembalikan hasil callback. */
function update(name, fallback, fn) {
  const data = read(name, fallback);
  const result = fn(data);
  write(name, data);
  return result;
}

const uid = (prefix) =>
  `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

module.exports = { MEDIA_DIR, DATA_DIR, read, write, update, uid };

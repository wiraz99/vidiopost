/**
 * Kunci pintu aplikasi.
 *
 * Tanpa ini siapa pun yang tahu alamatnya bisa membuka halaman Jadwal dan
 * mengirim post ke SEMUA akun sosial media yang tersambung. Token Buffer ada
 * di server, jadi penyerang tidak perlu tahu tokennya sama sekali — cukup
 * menekan tombol Kirim.
 *
 * Sengaja tanpa dependensi baru: scrypt dan HMAC sudah ada di modul crypto
 * bawaan Node, dan sesi disimpan sebagai token bertanda tangan di cookie
 * (stateless), bukan di memori — supaya login tidak putus tiap kali Coolify
 * merestart kontainer.
 *
 * BATAS YANG DISENGAJA: /media TIDAK ikut dikunci. Buffer mengunduh video dari
 * URL publik itu tanpa membawa kredensial apa pun, jadi menguncinya berarti
 * semua pengiriman gagal. Perlindungan untuk media bertumpu pada nama file yang
 * tidak bisa ditebak (lihat lib/media.js), bukan pada login.
 */
const crypto = require('crypto');
const store = require('./store');

const COOKIE = 'vps_sesi';
const MASA_BERLAKU_MS = Number(process.env.SESSION_TTL_MS || 30 * 24 * 60 * 60 * 1000); // 30 hari
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

// ---------------- kata sandi ----------------

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const key = crypto.scryptSync(String(password), salt, SCRYPT.keylen, {
    N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p
  });
  return `scrypt$${salt}$${key.toString('hex')}`;
}

function cocok(password, stored) {
  if (!stored) return false;
  const [skema, salt, hash] = String(stored).split('$');
  if (skema !== 'scrypt' || !salt || !hash) return false;
  const uji = crypto.scryptSync(String(password), salt, SCRYPT.keylen, {
    N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p
  });
  const asli = Buffer.from(hash, 'hex');
  // Panjang harus sama sebelum timingSafeEqual, kalau tidak dia melempar.
  if (asli.length !== uji.length) return false;
  return crypto.timingSafeEqual(asli, uji);
}

/**
 * Kredensial yang berlaku.
 * Kata sandi yang diubah lewat halaman Pengaturan menimpa yang dari env,
 * supaya penggantian sandi tidak perlu deploy ulang.
 */
function kredensial() {
  const tersimpan = store.read('auth', null);
  if (tersimpan?.hash) {
    return { user: tersimpan.user || 'admin', hash: tersimpan.hash, sumber: 'tersimpan' };
  }
  const envPass = process.env.AUTH_PASSWORD || '';
  if (envPass) {
    return { user: process.env.AUTH_USER || 'admin', hash: hashPassword(envPass, 'env-salt-tetap'), sumber: 'env' };
  }
  return null;
}

const sudahDiatur = () => !!kredensial();

function verifikasi(user, password) {
  const kred = kredensial();
  if (!kred) return false;
  // Nama pengguna tidak dianggap rahasia, tapi tetap harus cocok.
  if (String(user || '').trim().toLowerCase() !== kred.user.toLowerCase()) return false;
  // Kedua sumber sama-sama menyimpan hash scrypt lengkap dengan saltnya,
  // jadi pemeriksaannya identik.
  return cocok(password, kred.hash);
}

function gantiSandi({ user, password }) {
  const bersih = String(password || '');
  if (bersih.length < 8) {
    const err = new Error('Kata sandi minimal 8 karakter.');
    err.status = 400;
    throw err;
  }
  const nama = String(user || kredensial()?.user || 'admin').trim() || 'admin';
  store.write('auth', { user: nama, hash: hashPassword(bersih), diubahPada: new Date().toISOString() });
  // Semua sesi lama dibatalkan: rahasia sesi ikut diputar.
  putarRahasia();
  return { user: nama };
}

// ---------------- rahasia penanda tangan sesi ----------------

/**
 * Kalau SESSION_SECRET tidak diisi, dibuatkan sekali lalu disimpan di DATA_DIR.
 * Membuatnya acak tiap start akan memutus semua login tiap kali redeploy.
 */
function rahasia() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const tersimpan = store.read('session-secret', null);
  if (tersimpan?.value) return tersimpan.value;
  const baru = crypto.randomBytes(32).toString('hex');
  store.write('session-secret', { value: baru, dibuatPada: new Date().toISOString() });
  return baru;
}

function putarRahasia() {
  if (process.env.SESSION_SECRET) return; // dikendalikan dari luar, jangan disentuh
  store.write('session-secret', {
    value: crypto.randomBytes(32).toString('hex'),
    dibuatPada: new Date().toISOString()
  });
}

// ---------------- token sesi ----------------

const b64url = (buf) => Buffer.from(buf).toString('base64url');

function buatToken(user) {
  const payload = b64url(JSON.stringify({ u: user, exp: Date.now() + MASA_BERLAKU_MS }));
  const tanda = crypto.createHmac('sha256', rahasia()).update(payload).digest('base64url');
  return `${payload}.${tanda}`;
}

function bacaToken(token) {
  if (!token || typeof token !== 'string') return null;
  const [payload, tanda] = token.split('.');
  if (!payload || !tanda) return null;

  const harusnya = crypto.createHmac('sha256', rahasia()).update(payload).digest('base64url');
  const a = Buffer.from(tanda);
  const b = Buffer.from(harusnya);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data.exp || data.exp < Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}

// ---------------- cookie ----------------

function bacaCookie(req, nama) {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const bagian of raw.split(';')) {
    const i = bagian.indexOf('=');
    if (i === -1) continue;
    if (bagian.slice(0, i).trim() === nama) return decodeURIComponent(bagian.slice(i + 1).trim());
  }
  return null;
}

const lewatHttps = (req) =>
  req.secure || String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';

function pasangCookie(req, res, token) {
  const bagian = [
    `${COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(MASA_BERLAKU_MS / 1000)}`
  ];
  if (lewatHttps(req)) bagian.push('Secure');
  res.setHeader('Set-Cookie', bagian.join('; '));
}

function hapusCookie(req, res) {
  const bagian = [`${COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (lewatHttps(req)) bagian.push('Secure');
  res.setHeader('Set-Cookie', bagian.join('; '));
}

const sesiDari = (req) => bacaToken(bacaCookie(req, COOKIE));

// ---------------- rem percobaan login ----------------

const MAKS_GAGAL = 8;
const JENDELA_MS = 15 * 60 * 1000;
const percobaan = new Map();

function sisaBlokir(kunci) {
  const entri = percobaan.get(kunci);
  if (!entri) return 0;
  if (Date.now() > entri.sampai) {
    percobaan.delete(kunci);
    return 0;
  }
  return entri.gagal >= MAKS_GAGAL ? entri.sampai - Date.now() : 0;
}

function catatGagal(kunci) {
  const entri = percobaan.get(kunci) || { gagal: 0, sampai: 0 };
  entri.gagal++;
  entri.sampai = Date.now() + JENDELA_MS;
  percobaan.set(kunci, entri);
}

const bersihkanGagal = (kunci) => percobaan.delete(kunci);

module.exports = {
  COOKIE,
  sudahDiatur,
  kredensial,
  verifikasi,
  gantiSandi,
  hashPassword,
  cocok,
  buatToken,
  bacaToken,
  sesiDari,
  pasangCookie,
  hapusCookie,
  sisaBlokir,
  catatGagal,
  bersihkanGagal
};

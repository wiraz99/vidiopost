/**
 * Login, logout, dan ganti kata sandi.
 *
 * Endpoint di sini adalah satu-satunya yang boleh diakses tanpa sesi
 * (selain /media, yang memang harus terbuka untuk Buffer).
 */
const express = require('express');
const auth = require('../lib/auth');
const { asyncHandler, HttpError } = require('../lib/http');

const router = express.Router();

const alamat = (req) => req.ip || req.socket?.remoteAddress || 'entah';

router.get('/api/auth/status', (req, res) => {
  const sesi = auth.sesiDari(req);
  res.json({
    sudahDiatur: auth.sudahDiatur(),
    masuk: !!sesi,
    user: sesi?.u || null
  });
});

router.post('/api/auth/login', asyncHandler(async (req, res) => {
  if (!auth.sudahDiatur()) {
    throw new HttpError('Kata sandi belum diatur di server. Isi AUTH_PASSWORD dulu.', 503);
  }

  const kunci = alamat(req);
  const sisa = auth.sisaBlokir(kunci);
  if (sisa > 0) {
    throw new HttpError(
      `Terlalu banyak percobaan gagal. Coba lagi ${Math.ceil(sisa / 60000)} menit lagi.`,
      429
    );
  }

  const { user, password } = req.body || {};
  if (!auth.verifikasi(user, password)) {
    auth.catatGagal(kunci);
    // Sengaja tidak membedakan "user salah" dan "sandi salah".
    throw new HttpError('Nama pengguna atau kata sandi salah.', 401);
  }

  auth.bersihkanGagal(kunci);
  const nama = auth.kredensial().user;
  auth.pasangCookie(req, res, auth.buatToken(nama));
  res.json({ ok: true, user: nama });
}));

router.post('/api/auth/logout', (req, res) => {
  auth.hapusCookie(req, res);
  res.json({ ok: true });
});

/** Ganti kata sandi. Wajib sudah masuk DAN tahu sandi lamanya. */
router.post('/api/auth/password', asyncHandler(async (req, res) => {
  const sesi = auth.sesiDari(req);
  if (!sesi) throw new HttpError('Belum masuk.', 401);

  const { lama, baru, user } = req.body || {};
  if (!auth.verifikasi(sesi.u, lama)) throw new HttpError('Kata sandi lama salah.', 400);

  const hasil = auth.gantiSandi({ user: user || sesi.u, password: baru });

  // gantiSandi memutar rahasia sesi, jadi cookie lama sudah tidak berlaku —
  // termasuk milik peramban lain yang mungkin ikut terbuka. Sesi di sini
  // langsung diperbarui supaya user yang menggantinya tidak ikut terlempar.
  auth.pasangCookie(req, res, auth.buatToken(hasil.user));
  res.json({ ok: true, user: hasil.user });
}));

module.exports = router;

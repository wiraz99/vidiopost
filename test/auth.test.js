const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Store menulis ke DATA_DIR saat modul dimuat, jadi diarahkan ke folder
// sementara SEBELUM lib/auth ikut menariknya.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vps-auth-'));
process.env.MEDIA_DIR = path.join(tmp, 'media');
process.env.DATA_DIR = path.join(tmp, 'data');
delete process.env.SESSION_SECRET;
delete process.env.AUTH_PASSWORD;

const auth = require('../lib/auth');

test('tanpa AUTH_PASSWORD dan tanpa sandi tersimpan, aplikasi belum diatur', () => {
  assert.strictEqual(auth.sudahDiatur(), false);
  assert.strictEqual(auth.kredensial(), null);
});

test('hash tidak pernah menyimpan sandi apa adanya', () => {
  const hash = auth.hashPassword('rahasia-banget');
  assert.ok(!hash.includes('rahasia-banget'));
  assert.ok(hash.startsWith('scrypt$'));
});

test('salt berbeda menghasilkan hash berbeda untuk sandi yang sama', () => {
  assert.notStrictEqual(auth.hashPassword('sama'), auth.hashPassword('sama'));
});

test('cocok() menerima yang benar dan menolak yang salah', () => {
  const hash = auth.hashPassword('kunci-pintu-8');
  assert.strictEqual(auth.cocok('kunci-pintu-8', hash), true);
  assert.strictEqual(auth.cocok('kunci-pintu-9', hash), false);
  assert.strictEqual(auth.cocok('', hash), false);
});

test('hash rusak atau kosong ditolak, bukan bikin error', () => {
  for (const rusak of [null, '', 'bukan-format', 'scrypt$cuma-salt', 'md5$a$b']) {
    assert.strictEqual(auth.cocok('apa pun', rusak), false, String(rusak));
  }
});

test('AUTH_PASSWORD dari environment dipakai kalau belum ada yang tersimpan', () => {
  process.env.AUTH_PASSWORD = 'sandi-dari-env';
  assert.strictEqual(auth.sudahDiatur(), true);
  assert.strictEqual(auth.verifikasi('admin', 'sandi-dari-env'), true);
  assert.strictEqual(auth.verifikasi('admin', 'salah'), false);
  assert.strictEqual(auth.verifikasi('orang-lain', 'sandi-dari-env'), false);
});

test('nama pengguna tidak peduli huruf besar-kecil', () => {
  process.env.AUTH_PASSWORD = 'sandi-dari-env';
  assert.strictEqual(auth.verifikasi('ADMIN', 'sandi-dari-env'), true);
});

test('token sesi yang sah bisa dibaca kembali', () => {
  const token = auth.buatToken('admin');
  assert.strictEqual(auth.bacaToken(token).u, 'admin');
});

test('token yang diutak-atik ditolak', () => {
  const token = auth.buatToken('admin');
  const [payload, tanda] = token.split('.');

  assert.strictEqual(auth.bacaToken(`${payload}.${'a'.repeat(tanda.length)}`), null, 'tanda tangan diganti');
  assert.strictEqual(auth.bacaToken(`${payload}x.${tanda}`), null, 'payload diubah');
  assert.strictEqual(auth.bacaToken(payload), null, 'tanpa tanda tangan');
  assert.strictEqual(auth.bacaToken(''), null);
  assert.strictEqual(auth.bacaToken(null), null);
});

test('token yang mengaku user lain tetap ditolak tanpa tanda tangan yang benar', () => {
  const palsu = Buffer.from(JSON.stringify({ u: 'admin', exp: Date.now() + 60000 })).toString('base64url');
  assert.strictEqual(auth.bacaToken(`${palsu}.tandatangan-karangan`), null);
});

test('token kedaluwarsa ditolak', () => {
  const crypto = require('crypto');
  const secret = require('../lib/store').read('session-secret', null).value;
  const payload = Buffer.from(JSON.stringify({ u: 'admin', exp: Date.now() - 1000 })).toString('base64url');
  const tanda = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  assert.strictEqual(auth.bacaToken(`${payload}.${tanda}`), null);
});

test('ganti sandi: tersimpan menang atas environment, dan sesi lama batal', () => {
  process.env.AUTH_PASSWORD = 'sandi-dari-env';
  const tokenLama = auth.buatToken('admin');
  assert.ok(auth.bacaToken(tokenLama), 'token lama harusnya sah sebelum diganti');

  auth.gantiSandi({ user: 'arachy', password: 'sandi-baru-panjang' });

  assert.strictEqual(auth.verifikasi('arachy', 'sandi-baru-panjang'), true);
  assert.strictEqual(auth.verifikasi('admin', 'sandi-dari-env'), false, 'sandi env tidak berlaku lagi');
  assert.strictEqual(auth.bacaToken(tokenLama), null, 'sesi lama harus batal setelah ganti sandi');
});

test('sandi baru yang terlalu pendek ditolak', () => {
  assert.throws(() => auth.gantiSandi({ user: 'arachy', password: 'pendek' }), /minimal 8/);
});

test('rem percobaan login menyala setelah gagal berkali-kali', () => {
  const kunci = 'uji-1.2.3.4';
  assert.strictEqual(auth.sisaBlokir(kunci), 0);
  for (let i = 0; i < 8; i++) auth.catatGagal(kunci);
  assert.ok(auth.sisaBlokir(kunci) > 0, 'harus terblokir setelah 8 kali gagal');

  auth.bersihkanGagal(kunci);
  assert.strictEqual(auth.sisaBlokir(kunci), 0, 'login berhasil harus mereset hitungannya');
});

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

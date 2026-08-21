const test = require('node:test');
const assert = require('node:assert');
const { periksaUntukPinterest } = require('../lib/linkcheck');
const { buildPost } = require('../lib/compose');

const dasar = { platform: 'pinterest', title: 'Sale Pisang', caption: 'Renyah', boardId: 'b1' };

// Pinterest satu-satunya platform yang memakai link sebagai TUJUAN pin, dan
// menolak link pendek dengan pesan "Unknown error" yang tidak menjelaskan apa pun.

test('link pemendek dicegat sebelum dikirim', () => {
  for (const url of ['https://shope.ee/9pAbCd', 'https://s.id/toko', 'https://bit.ly/xyz', 'https://tinyurl.com/abc']) {
    const { blokir } = periksaUntukPinterest(url);
    assert.ok(blokir, `${url} seharusnya diblokir`);
    assert.match(blokir, /Unknown error/, 'pesannya harus menyebut gejala yang dilihat user');
  }
});

test('URL lengkap yang wajar diloloskan', () => {
  for (const url of ['https://shopee.co.id/arachynana', 'https://arachynana.com/katalog', 'https://tokopedia.com/toko']) {
    const { blokir, peringatan } = periksaUntukPinterest(url);
    assert.strictEqual(blokir, null, url);
    assert.strictEqual(peringatan, null, url);
  }
});

test('link kosong bukan masalah — pin boleh tanpa tujuan', () => {
  const { blokir, peringatan } = periksaUntukPinterest('');
  assert.strictEqual(blokir, null);
  assert.strictEqual(peringatan, null);
});

test('teks yang bukan URL dicegat', () => {
  assert.ok(periksaUntukPinterest('bukan url sama sekali').blokir);
});

test('link WhatsApp diperingatkan, tapi tidak memblokir', () => {
  const { blokir, peringatan } = periksaUntukPinterest('https://wa.me/6281234567');
  assert.strictEqual(blokir, null, 'jangan memblokir hal yang belum pasti ditolak');
  assert.ok(peringatan);
});

// ---------- lewat buildPost, sebagaimana dipakai rute pengiriman ----------

test('buildPost melaporkan link pendek sebagai kekurangan, dan tidak mengirimnya', () => {
  const { metadata, missing } = buildPost({ ...dasar, link: 'https://shope.ee/9pAbCd' });
  assert.ok(missing.some((m) => /pemendek/i.test(m)), missing.join(' | '));
  assert.strictEqual(metadata.pinterest.url, undefined, 'link bermasalah jangan ikut terkirim');
  assert.strictEqual(metadata.pinterest.boardServiceId, 'b1', 'board tetap terpasang');
});

test('buildPost meneruskan link yang sah ke field url', () => {
  const { metadata, missing } = buildPost({ ...dasar, link: 'https://shopee.co.id/arachynana' });
  assert.deepStrictEqual(missing, []);
  assert.strictEqual(metadata.pinterest.url, 'https://shopee.co.id/arachynana');
});

test('peringatan lunak sampai ke warning, tanpa memblokir', () => {
  const { missing, warning } = buildPost({ ...dasar, link: 'https://wa.me/6281234567' });
  assert.deepStrictEqual(missing, []);
  assert.match(warning || '', /wa\.me/);
});

test('platform lain tidak terpengaruh pemeriksaan ini', () => {
  for (const platform of ['youtube', 'facebook']) {
    const { missing, text } = buildPost({
      platform, title: 'Judul', caption: 'Isi', link: 'https://shope.ee/9pAbCd'
    });
    assert.deepStrictEqual(missing, [], platform);
    assert.ok(text.includes('shope.ee'), `${platform} tetap menempelkan link di teks`);
  }
});

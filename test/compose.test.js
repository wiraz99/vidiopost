const test = require('node:test');
const assert = require('node:assert');
const { buildPost } = require('../lib/compose');

const base = {
  title: 'Sale Pisang Granola Renyah',
  caption: 'Camilan sore favorit keluarga',
  hashtags: ['#SalePisangGranola', '#Arachynana'],
  link: 'https://shopee.co.id/arachynana'
};

// ---------- field wajib per platform ----------
// Semua kasus di bawah ini pernah ditolak Buffer sungguhan.

test('Instagram wajib punya type + shouldShareToFeed', () => {
  const { metadata, missing } = buildPost({ ...base, platform: 'instagram' });
  assert.strictEqual(metadata.instagram.type, 'reel');
  assert.strictEqual(metadata.instagram.shouldShareToFeed, true);
  assert.deepStrictEqual(missing, []);
});

test('YouTube wajib punya title + categoryId', () => {
  const { metadata, missing } = buildPost({ ...base, platform: 'youtube' });
  assert.strictEqual(metadata.youtube.title, base.title);
  assert.ok(metadata.youtube.categoryId, 'categoryId harus terisi');
  assert.deepStrictEqual(missing, []);
});

test('YouTube tanpa judul dilaporkan kurang, bukan dikirim lalu ditolak', () => {
  const { missing } = buildPost({ ...base, platform: 'youtube', title: '' });
  assert.ok(missing.some((m) => m.includes('judul')), missing.join(' | '));
});

test('judul YouTube dipangkas ke 100 karakter', () => {
  const { metadata } = buildPost({ ...base, platform: 'youtube', title: 'A'.repeat(150) });
  assert.strictEqual(metadata.youtube.title.length, 100);
});

test('Pinterest wajib punya boardServiceId', () => {
  const tanpaBoard = buildPost({ ...base, platform: 'pinterest' });
  assert.ok(tanpaBoard.missing.some((m) => m.includes('board')), tanpaBoard.missing.join(' | '));

  const denganBoard = buildPost({ ...base, platform: 'pinterest', boardId: 'board-123' });
  assert.strictEqual(denganBoard.metadata.pinterest.boardServiceId, 'board-123');
  assert.strictEqual(denganBoard.metadata.pinterest.title, base.title);
  assert.strictEqual(denganBoard.metadata.pinterest.url, base.link);
  assert.deepStrictEqual(denganBoard.missing, []);
});

test('TikTok, Facebook, Threads tidak butuh metadata', () => {
  for (const platform of ['tiktok', 'facebook', 'threads']) {
    const { metadata, missing } = buildPost({ ...base, platform });
    assert.strictEqual(metadata, null, platform);
    assert.deepStrictEqual(missing, [], platform);
  }
});

// ---------- judul & link tidak lagi ditempel ke teks ----------

test('judul TIDAK ikut ke teks di platform yang punya field judul sendiri', () => {
  for (const platform of ['youtube', 'pinterest']) {
    const { text } = buildPost({ ...base, platform, boardId: 'b1' });
    assert.ok(!text.includes(base.title), `${platform} seharusnya tidak mengulang judul di teks:\n${text}`);
  }
});

test('link Pinterest masuk ke field url, bukan ke teks', () => {
  const { text, metadata } = buildPost({ ...base, platform: 'pinterest', boardId: 'b1' });
  assert.ok(!text.includes(base.link), `link seharusnya tidak di teks:\n${text}`);
  assert.strictEqual(metadata.pinterest.url, base.link);
});

test('link tetap ditempel di YouTube & Facebook karena tak ada field khusus', () => {
  for (const platform of ['youtube', 'facebook']) {
    const { text } = buildPost({ ...base, platform });
    assert.ok(text.includes(base.link), `${platform} seharusnya memuat link:\n${text}`);
  }
});

test('TikTok & Instagram tidak disisipi link', () => {
  for (const platform of ['tiktok', 'instagram']) {
    const { text } = buildPost({ ...base, platform });
    assert.ok(!text.includes(base.link), `${platform} seharusnya tanpa link:\n${text}`);
  }
});

// ---------- hashtag ----------

test('hashtag hanya di platform yang memang memakainya', () => {
  for (const platform of ['tiktok', 'instagram', 'facebook', 'threads']) {
    assert.ok(buildPost({ ...base, platform }).text.includes('#Arachynana'), platform);
  }
  for (const platform of ['youtube', 'pinterest']) {
    const { text } = buildPost({ ...base, platform, boardId: 'b1' });
    assert.ok(!text.includes('#Arachynana'), `${platform} seharusnya tanpa hashtag:\n${text}`);
  }
});

test('hashtag yang sudah ada di caption tidak diduplikasi', () => {
  const { text } = buildPost({
    platform: 'tiktok',
    caption: 'Renyah banget #Arachynana',
    hashtags: ['#Arachynana', '#CamilanSehat']
  });
  assert.strictEqual(text.match(/#Arachynana/gi).length, 1);
  assert.ok(text.includes('#CamilanSehat'));
});

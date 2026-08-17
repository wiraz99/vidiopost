/**
 * Setelan berlapis: channel → umum → environment → bawaan kode.
 *
 * Lapisan ini yang menentukan isi metadata yang dikirim ke Buffer, dan
 * kesalahannya tidak kelihatan sampai post ditolak. Jadi diuji langsung sampai
 * ke hasil buildPost, bukan cuma nilai setelannya.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert');

// Harus disetel SEBELUM lib/store diimpor — store menentukan foldernya saat dimuat.
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'vpa-settings-'));
process.env.DATA_DIR = DIR;
process.env.MEDIA_DIR = DIR;

// Bersihkan env supaya yang diuji benar-benar lapisan setelan, bukan sisa .env.
for (const key of ['INSTAGRAM_POST_TYPE', 'FACEBOOK_POST_TYPE', 'INSTAGRAM_SHARE_TO_FEED',
  'YOUTUBE_CATEGORY_ID', 'YOUTUBE_PRIVACY', 'PINTEREST_BOARD_ID', 'TIMEZONE']) {
  delete process.env[key];
}

const settings = require('../lib/settings');
const { buildPost } = require('../lib/compose');

const reset = () => {
  for (const nama of ['app-settings', 'channel-settings']) {
    const f = path.join(DIR, `${nama}.json`);
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
};

test.beforeEach(reset);

// ---------- lapisan ----------

test('tanpa setelan apa pun, dipakai bawaan kode', () => {
  const s = settings.globalSettings();
  assert.strictEqual(s.instagramType, 'reel');
  assert.strictEqual(s.youtubeCategoryId, '26');
  assert.strictEqual(s.youtubePrivacy, 'public');
  assert.strictEqual(s.timezone, 'Asia/Jakarta');
});

test('environment variable jadi lapisan bawaan kalau tidak ada setelan tersimpan', () => {
  process.env.YOUTUBE_PRIVACY = 'unlisted';
  try {
    assert.strictEqual(settings.globalSettings().youtubePrivacy, 'unlisted');
  } finally {
    delete process.env.YOUTUBE_PRIVACY;
  }
});

test('setelan umum menimpa environment', () => {
  process.env.YOUTUBE_PRIVACY = 'unlisted';
  try {
    settings.saveGlobal({ youtubePrivacy: 'private' });
    assert.strictEqual(settings.globalSettings().youtubePrivacy, 'private');
  } finally {
    delete process.env.YOUTUBE_PRIVACY;
  }
});

test('setelan channel menimpa setelan umum', () => {
  settings.saveGlobal({ instagramType: 'post' });
  settings.saveChannel('ch_ig', { instagramType: 'story' });

  assert.strictEqual(settings.forChannel('ch_ig').instagramType, 'story');
  // channel lain tetap ikut yang umum
  assert.strictEqual(settings.forChannel('ch_lain').instagramType, 'post');
});

test('mengosongkan setelan channel mengembalikannya ke setelan umum', () => {
  settings.saveGlobal({ instagramType: 'post' });
  settings.saveChannel('ch_ig', { instagramType: 'story' });
  settings.saveChannel('ch_ig', { instagramType: '' });

  assert.strictEqual(settings.forChannel('ch_ig').instagramType, 'post');
  assert.strictEqual(settings.readChannelsRaw().ch_ig.instagramType, undefined);
});

test('kunci yang tidak dikenal diabaikan, bukan disimpan diam-diam', () => {
  settings.saveGlobal({ instagramType: 'post', adminPassword: 'rahasia' });
  assert.strictEqual(settings.readGlobalRaw().adminPassword, undefined);
});

// ---------- validasi ----------

test('nilai ngawur ditolak, tidak dibiarkan sampai ke Buffer', () => {
  assert.throws(() => settings.saveGlobal({ instagramType: 'karusel' }), /Tipe post Instagram/);
  assert.throws(() => settings.saveGlobal({ youtubePrivacy: 'rahasia' }), /Privasi YouTube/);
  assert.throws(() => settings.saveGlobal({ youtubeCategoryId: 'howto' }), /angka/);
  assert.throws(() => settings.saveGlobal({ timezone: 'Asia/Ngawi' }), /tidak dikenali/);
  assert.throws(() => settings.saveChannel('ch', { hour: '9 pagi' }), /HH:mm/);
});

test('zona waktu yang sah diterima', () => {
  settings.saveGlobal({ timezone: 'Asia/Makassar' });
  assert.strictEqual(settings.globalSettings().timezone, 'Asia/Makassar');
});

// ---------- jam tayang ----------

test('jam tayang per channel dikumpulkan untuk penyusun jadwal', () => {
  settings.saveChannel('ch_a', { hour: '19:00' });
  settings.saveChannel('ch_b', { hour: '07:30' });
  settings.saveChannel('ch_c', { boardId: 'b1' }); // tanpa jam

  assert.deepStrictEqual(settings.channelHours(), { ch_a: '19:00', ch_b: '07:30' });
});

// ---------- sampai ke metadata yang dikirim ----------

test('setelan channel benar-benar mengubah metadata post Instagram', () => {
  settings.saveChannel('ch_ig', { instagramType: 'post', instagramShareToFeed: false });

  const { metadata } = buildPost({
    platform: 'instagram',
    caption: 'halo',
    settings: settings.forChannel('ch_ig')
  });
  assert.strictEqual(metadata.instagram.type, 'post');
  assert.strictEqual(metadata.instagram.shouldShareToFeed, false);
});

test('kategori & privasi YouTube ikut setelan channel', () => {
  settings.saveGlobal({ youtubeCategoryId: '22' });
  settings.saveChannel('ch_yt', { youtubePrivacy: 'private' });

  const { metadata } = buildPost({
    platform: 'youtube',
    title: 'Judul',
    settings: settings.forChannel('ch_yt')
  });
  assert.strictEqual(metadata.youtube.categoryId, '22');
  assert.strictEqual(metadata.youtube.privacy, 'private');
});

test('board Pinterest dari setelan channel dipakai kalau tidak dikirim langsung', () => {
  settings.saveChannel('ch_pn', { boardId: 'board-dari-setelan' });

  const dariSetelan = buildPost({ platform: 'pinterest', settings: settings.forChannel('ch_pn') });
  assert.strictEqual(dariSetelan.metadata.pinterest.boardServiceId, 'board-dari-setelan');
  assert.deepStrictEqual(dariSetelan.missing, []);

  // boardId yang dikirim langsung tetap menang
  const langsung = buildPost({
    platform: 'pinterest', boardId: 'board-khusus', settings: settings.forChannel('ch_pn')
  });
  assert.strictEqual(langsung.metadata.pinterest.boardServiceId, 'board-khusus');
});

test('tanpa settings, buildPost tetap jalan seperti sebelumnya', () => {
  const { metadata, missing } = buildPost({ platform: 'instagram', caption: 'halo' });
  assert.strictEqual(metadata.instagram.type, 'reel');
  assert.deepStrictEqual(missing, []);
});

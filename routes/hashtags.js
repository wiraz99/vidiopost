/** Set hashtag: CRUD + saran dari AI. Menggantikan HASHTAG_BANK yang dulu hardcoded. */
const express = require('express');
const store = require('../lib/store');
const ai = require('../lib/ai');
const { asyncHandler, HttpError } = require('../lib/http');

const router = express.Router();

// Set bawaan saat pertama kali dipakai, supaya halaman tidak kosong melompong.
const SEED = [
  {
    id: 'hs_brand',
    name: 'Brand',
    tags: ['#SalePisangGranola', '#Arachynana', '#CamilanSehat'],
    platforms: [],          // kosong = berlaku untuk semua platform
    isDefault: true
  }
];

function readSets() {
  const sets = store.read('hashtags', null);
  if (sets) return sets;
  store.write('hashtags', SEED);
  return SEED;
}

/** Rapikan hashtag: buang spasi, pastikan diawali satu '#', buang duplikat. */
function normalizeTags(input) {
  const list = Array.isArray(input)
    ? input
    : String(input || '').split(/[\s,\n]+/);

  const seen = new Set();
  const out = [];
  for (const raw of list) {
    if (typeof raw !== 'string') continue;
    const tag = ('#' + raw.trim().replace(/^#+/, '')).replace(/\s+/g, '');
    if (tag.length < 2 || seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    out.push(tag);
  }
  return out;
}

router.get('/api/hashtags', (req, res) => res.json({ sets: readSets() }));

router.post('/api/hashtags', asyncHandler(async (req, res) => {
  const { name, tags, platforms, isDefault } = req.body || {};
  if (!name?.trim()) throw new HttpError('Nama set wajib diisi', 400);

  const set = {
    id: store.uid('hs'),
    name: name.trim(),
    tags: normalizeTags(tags),
    platforms: Array.isArray(platforms) ? platforms : [],
    isDefault: !!isDefault,
    createdAt: new Date().toISOString()
  };
  const sets = readSets();
  sets.push(set);
  store.write('hashtags', sets);
  res.json({ set });
}));

router.patch('/api/hashtags/:id', asyncHandler(async (req, res) => {
  const sets = readSets();
  const set = sets.find((s) => s.id === req.params.id);
  if (!set) throw new HttpError('Set tidak ditemukan', 404);

  const { name, tags, platforms, isDefault } = req.body || {};
  if (name !== undefined) set.name = String(name).trim() || set.name;
  if (tags !== undefined) set.tags = normalizeTags(tags);
  if (platforms !== undefined) set.platforms = Array.isArray(platforms) ? platforms : [];
  if (isDefault !== undefined) set.isDefault = !!isDefault;

  store.write('hashtags', sets);
  res.json({ set });
}));

router.delete('/api/hashtags/:id', asyncHandler(async (req, res) => {
  const sets = readSets();
  const index = sets.findIndex((s) => s.id === req.params.id);
  if (index === -1) throw new HttpError('Set tidak ditemukan', 404);
  const [removed] = sets.splice(index, 1);
  store.write('hashtags', sets);
  res.json({ ok: true, removed });
}));

/** Minta AI mengusulkan hashtag. Hasilnya belum disimpan — user yang memutuskan. */
router.post('/api/hashtags/suggest', asyncHandler(async (req, res) => {
  const { brief, platform, count } = req.body || {};
  if (!brief?.trim()) throw new HttpError('Isi brief dulu supaya AI punya konteks', 400);
  const tags = await ai.suggestHashtags({ brief: brief.trim(), platform, count });
  res.json({ tags });
}));

/**
 * Gabungan hashtag dari beberapa set untuk satu platform.
 * Dipakai lib/plan saat menyusun teks post.
 */
function tagsFor(setIds, platform) {
  const sets = readSets();
  const chosen = setIds?.length ? sets.filter((s) => setIds.includes(s.id)) : sets.filter((s) => s.isDefault);

  const seen = new Set();
  const out = [];
  for (const set of chosen) {
    if (set.platforms?.length && !set.platforms.includes(platform)) continue;
    for (const tag of set.tags) {
      if (seen.has(tag.toLowerCase())) continue;
      seen.add(tag.toLowerCase());
      out.push(tag);
    }
  }
  return out;
}

module.exports = router;
module.exports.tagsFor = tagsFor;
module.exports.readSets = readSets;

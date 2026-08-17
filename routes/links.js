/**
 * Bank tautan: marketplace, WhatsApp, katalog — link yang dipakai berulang
 * dan disisipkan ke post di platform yang memang memerlukannya
 * (mis. link tujuan Pinterest, link di deskripsi YouTube).
 */
const express = require('express');
const store = require('../lib/store');
const { asyncHandler, HttpError } = require('../lib/http');

const router = express.Router();

const readLinks = () => store.read('links', []);
const writeLinks = (l) => store.write('links', l);

/** Rapikan URL: tambahkan https:// kalau user cuma menulis domainnya. */
function normalizeUrl(raw) {
  const url = String(raw || '').trim();
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) return url;
  if (/^(wa\.me|api\.whatsapp\.com)/i.test(url)) return `https://${url}`;
  return `https://${url}`;
}

function validate(url) {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return 'Link harus diawali http:// atau https://';
    if (!parsed.hostname.includes('.')) return 'Alamat domainnya sepertinya belum lengkap';
    return null;
  } catch {
    return 'Format link tidak dikenali';
  }
}

router.get('/api/links', (req, res) => res.json({ links: readLinks() }));

router.post('/api/links', asyncHandler(async (req, res) => {
  const { name, url, note, platforms, isDefault } = req.body || {};
  if (!name?.trim()) throw new HttpError('Nama tautan wajib diisi', 400);

  const clean = normalizeUrl(url);
  if (!clean) throw new HttpError('Link wajib diisi', 400);
  const problem = validate(clean);
  if (problem) throw new HttpError(problem, 400);

  const link = {
    id: store.uid('lnk'),
    name: name.trim(),
    url: clean,
    note: (note || '').trim(),
    platforms: Array.isArray(platforms) ? platforms : [],
    isDefault: !!isDefault,
    createdAt: new Date().toISOString()
  };

  const links = readLinks();
  // Hanya boleh ada satu tautan default.
  if (link.isDefault) for (const l of links) l.isDefault = false;
  links.push(link);
  writeLinks(links);

  res.json({ link });
}));

router.patch('/api/links/:id', asyncHandler(async (req, res) => {
  const links = readLinks();
  const link = links.find((l) => l.id === req.params.id);
  if (!link) throw new HttpError('Tautan tidak ditemukan', 404);

  const { name, url, note, platforms, isDefault } = req.body || {};

  if (name !== undefined) link.name = String(name).trim() || link.name;
  if (url !== undefined) {
    const clean = normalizeUrl(url);
    const problem = clean ? validate(clean) : 'Link wajib diisi';
    if (problem) throw new HttpError(problem, 400);
    link.url = clean;
  }
  if (note !== undefined) link.note = String(note).trim();
  if (platforms !== undefined) link.platforms = Array.isArray(platforms) ? platforms : [];
  if (isDefault !== undefined) {
    link.isDefault = !!isDefault;
    if (link.isDefault) for (const l of links) if (l.id !== link.id) l.isDefault = false;
  }

  writeLinks(links);
  res.json({ link });
}));

router.delete('/api/links/:id', asyncHandler(async (req, res) => {
  const links = readLinks();
  const index = links.findIndex((l) => l.id === req.params.id);
  if (index === -1) throw new HttpError('Tautan tidak ditemukan', 404);
  const [removed] = links.splice(index, 1);
  writeLinks(links);
  res.json({ ok: true, removed });
}));

/**
 * Tentukan URL yang dipakai sebuah video di platform tertentu.
 * Urutan: tautan yang dipilih video → tautan default → link ketikan bebas.
 * Tautan yang dibatasi ke platform lain diabaikan.
 */
function resolveLink(video, platform) {
  const links = readLinks();

  const usable = (l) => l && (!l.platforms?.length || l.platforms.includes(platform));

  if (video?.linkId) {
    const chosen = links.find((l) => l.id === video.linkId);
    if (usable(chosen)) return chosen.url;
    if (chosen) return ''; // sengaja dipilih tapi tidak berlaku di platform ini
  }

  const fallback = links.find((l) => l.isDefault);
  if (usable(fallback)) return fallback.url;

  return video?.link || '';
}

module.exports = router;
module.exports.resolveLink = resolveLink;
module.exports.readLinks = readLinks;

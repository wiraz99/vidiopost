/**
 * Bank tautan: marketplace, WhatsApp, katalog — link yang dipakai berulang
 * dan disisipkan ke post di platform yang memang memerlukannya
 * (mis. link tujuan Pinterest, link di deskripsi YouTube).
 */
const express = require('express');
const store = require('../lib/store');
const groups = require('../lib/groups');
const { saring, milikGrup } = require('../lib/group-scope');
const { periksaUntukPinterest } = require('../lib/linkcheck');
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

// Tiap tautan dilengkapi vonis kelayakannya sebagai tujuan pin Pinterest.
// Pinterest satu-satunya platform yang memakai link sebagai TUJUAN, dan
// menolak link pendek dengan pesan "Unknown error" yang menyesatkan.
router.get('/api/links', (req, res) => {
  const grup = groups.resolusi(req.query.grup);
  const semua = readLinks();
  const daftar = grup.semua ? semua : saring(semua, grup.id, groups.bawaanId());

  res.json({
    groupId: grup.id,
    grupTidakDikenal: grup.tidakDikenal,
    links: daftar.map((l) => {
      const { blokir, peringatan } = periksaUntukPinterest(l.url);
      return { ...l, pinterest: blokir ? { blokir } : peringatan ? { peringatan } : null };
    })
  });
});

router.post('/api/links', asyncHandler(async (req, res) => {
  const { name, url, note, platforms, isDefault, groupId, semuaGrup } = req.body || {};
  if (!name?.trim()) throw new HttpError('Nama tautan wajib diisi', 400);
  if (groupId && !groups.cari(groupId)) throw new HttpError(`Grup "${groupId}" tidak ada.`, 400);

  const clean = normalizeUrl(url);
  if (!clean) throw new HttpError('Link wajib diisi', 400);
  const problem = validate(clean);
  if (problem) throw new HttpError(problem, 400);

  const link = {
    id: store.uid('lnk'),
    name: name.trim(),
    groupId: groupId || groups.bawaanId(),
    semuaGrup: semuaGrup === true,
    url: clean,
    note: (note || '').trim(),
    platforms: Array.isArray(platforms) ? platforms : [],
    isDefault: !!isDefault,
    createdAt: new Date().toISOString()
  };

  const links = readLinks();
  // Hanya boleh ada satu tautan utama PER GRUP — tautan utama brand lain tidak
  // boleh ikut dimatikan, dan tidak boleh ikut terpasang di post grup ini.
  if (link.isDefault) {
    for (const l of links) if (milikGrup(l, link.groupId, groups.bawaanId())) l.isDefault = false;
  }
  links.push(link);
  writeLinks(links);

  res.json({ link });
}));

router.patch('/api/links/:id', asyncHandler(async (req, res) => {
  const links = readLinks();
  const link = links.find((l) => l.id === req.params.id);
  if (!link) throw new HttpError('Tautan tidak ditemukan', 404);

  const { name, url, note, platforms, isDefault, groupId, semuaGrup } = req.body || {};

  if (groupId !== undefined) {
    if (!groups.cari(groupId)) throw new HttpError(`Grup "${groupId}" tidak ada.`, 400);
    link.groupId = groupId;
  }
  if (semuaGrup !== undefined) link.semuaGrup = semuaGrup === true;
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
    if (link.isDefault) {
      const bawaanId = groups.bawaanId();
      for (const l of links) {
        if (l.id !== link.id && milikGrup(l, link.groupId || bawaanId, bawaanId)) l.isDefault = false;
      }
    }
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
 * Urutan: tautan yang dipilih video → tautan utama → link ketikan bebas.
 * Tautan yang dibatasi ke platform lain diabaikan.
 *
 * Tautan utama disaring ke grup videonya. Tanpa itu, post brand A bisa membawa
 * link toko brand B — kesalahan yang tidak muncul di layar mana pun sampai
 * pin-nya tayang dan mengarahkan orang ke toko yang salah.
 */
function resolveLink(video, platform) {
  const links = readLinks();
  const bawaanId = groups.bawaanId();

  const usable = (l) => l && (!l.platforms?.length || l.platforms.includes(platform));

  if (video?.linkId) {
    const chosen = links.find((l) => l.id === video.linkId);
    if (usable(chosen)) return chosen.url;
    if (chosen) return ''; // sengaja dipilih tapi tidak berlaku di platform ini
  }

  const grupVideo = video?.groupId || bawaanId;
  const fallback = links.find((l) => l.isDefault && milikGrup(l, grupVideo, bawaanId));
  if (usable(fallback)) return fallback.url;

  return video?.link || '';
}

module.exports = router;
module.exports.resolveLink = resolveLink;
module.exports.readLinks = readLinks;

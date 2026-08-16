require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const fetch = require('node-fetch');

const app = express();
app.use(express.json());

// ---------- Config ----------
const PORT = process.env.PORT || 3000;
const MEDIA_DIR = process.env.MEDIA_DIR || path.join(__dirname, 'media');
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`;
const HERMES_API_URL = process.env.HERMES_API_URL; // e.g. http://hermes:port/v1/chat/completions
const HERMES_API_KEY = process.env.HERMES_API_KEY || '';
const BUFFER_TOKEN_A = process.env.BUFFER_TOKEN_A;
const BUFFER_TOKEN_B = process.env.BUFFER_TOKEN_B;

// channels.json defines which channelId belongs to which Buffer account (A or B)
// Example:
// [
//   { "id": "channel_id_1", "platform": "instagram", "label": "IG Dapur Arsy", "account": "A" },
//   { "id": "channel_id_2", "platform": "tiktok", "label": "TikTok Dapur Arsy", "account": "A" }
// ]
const channels = JSON.parse(fs.readFileSync(path.join(__dirname, 'channels.json'), 'utf8'));

if (!fs.existsSync(MEDIA_DIR)) fs.mkdirSync(MEDIA_DIR, { recursive: true });

// Data persisten (riwayat + hitungan antrian). Default-nya ditaruh DI DALAM MEDIA_DIR
// supaya ikut kebawa persistent volume Coolify dan tidak hilang tiap redeploy.
const DATA_DIR = process.env.DATA_DIR || path.join(MEDIA_DIR, '_data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');
const QUEUE_FILE = path.join(DATA_DIR, 'queue.json');
const QUEUE_LIMIT = Number(process.env.QUEUE_LIMIT || 10);

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

// serve uploaded media publicly (this is the "public URL" Buffer's API requires)
app.use('/media', express.static(MEDIA_DIR));
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Upload ----------
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, MEDIA_DIR),
  filename: (req, file, cb) => {
    const safeName = Date.now() + '-' + file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_');
    cb(null, safeName);
  }
});
const upload = multer({ storage, limits: { fileSize: 500 * 1024 * 1024 } }); // 500MB cap

app.post('/api/upload', upload.single('video'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const publicUrl = `${PUBLIC_BASE_URL}/media/${req.file.filename}`;
  res.json({ url: publicUrl, filename: req.file.filename });
});

app.get('/api/channels', (req, res) => {
  res.json(channels);
});

// ---------- Caption generation (Hermes) ----------
app.post('/api/caption', async (req, res) => {
  const { brief, platforms } = req.body; // platforms: array of platform names to generate for
  if (!HERMES_API_URL) return res.status(500).json({ error: 'HERMES_API_URL not configured' });

  const prompt = `Buatkan caption sosial media untuk video dengan konteks: "${brief}".
Buat versi caption terpisah untuk platform berikut: ${platforms.join(', ')}.
Balas HANYA dalam format JSON valid seperti ini, tanpa teks lain:
{ "instagram": "...", "tiktok": "...", "facebook": "...", "youtube": "..." }
(sertakan hanya key untuk platform yang diminta)`;

  try {
    const r = await fetch(HERMES_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(HERMES_API_KEY ? { Authorization: `Bearer ${HERMES_API_KEY}` } : {})
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: prompt }]
      })
    });
    const data = await r.json();
    const text = data.choices?.[0]?.message?.content || data.content || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const captions = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
    res.json({ captions });
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate captions', detail: String(err) });
  }
});

// ---------- Publish (Buffer) ----------
async function bufferCreatePost({ token, channelId, text, videoUrl }) {
  const query = `
    mutation CreatePost($input: CreatePostInput!) {
      createPost(input: $input) {
        ... on PostActionSuccess { post { id dueAt } }
        ... on MutationError { message }
      }
    }`;
  const variables = {
    input: {
      text,
      channelId,
      schedulingType: 'automatic',
      mode: 'addToQueue',
      assets: videoUrl ? [{ video: { url: videoUrl } }] : []
    }
  };
  const r = await fetch('https://api.buffer.com/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ query, variables })
  });
  return r.json();
}

app.post('/api/publish', async (req, res) => {
  const { videoUrl, captionsByChannelId, channelIds } = req.body;
  // captionsByChannelId: { [channelId]: "caption text" }
  // channelIds: array of channel IDs selected by the user

  const results = [];
  for (const channelId of channelIds) {
    const channel = channels.find(c => c.id === channelId);
    if (!channel) {
      results.push({ channelId, ok: false, error: 'Channel not found in channels.json' });
      continue;
    }
    const token = channel.account === 'A' ? BUFFER_TOKEN_A : BUFFER_TOKEN_B;
    if (!token) {
      results.push({ channelId, ok: false, error: `No Buffer token configured for account ${channel.account}` });
      continue;
    }
    try {
      const result = await bufferCreatePost({
        token,
        channelId,
        text: captionsByChannelId[channelId] || '',
        videoUrl
      });
      results.push({ channelId, label: channel.label, ok: !result.errors, result });
    } catch (err) {
      results.push({ channelId, ok: false, error: String(err) });
    }
  }
  res.json({ results });
});

// ---------- Kuota antrian Buffer (endpoint baru) ----------
// Buffer membatasi antrian 10 post per channel. Hitungan di sini adalah hitungan
// LOKAL: naik tiap publish sukses lewat app ini. Karena post yang sudah tayang
// keluar dari antrian di sisi Buffer, angka ini bisa disinkronkan manual lewat
// POST /api/queue (lihat tombol "Sinkron" di UI).
function readQueue() {
  const stored = readJson(QUEUE_FILE, {});
  const counts = {};
  for (const c of channels) counts[c.id] = Number(stored[c.id]) || 0;
  return counts;
}

app.get('/api/queue', (req, res) => {
  res.json({ limit: QUEUE_LIMIT, counts: readQueue() });
});

// Body: { channelId, pending }  -> set nilai absolut
//   atau { channelId, delta }   -> tambah/kurang
app.post('/api/queue', (req, res) => {
  const { channelId, pending, delta } = req.body || {};
  if (!channels.some(c => c.id === channelId)) {
    return res.status(400).json({ error: 'Unknown channelId' });
  }
  const counts = readQueue();
  const next = pending !== undefined ? Number(pending) : counts[channelId] + Number(delta || 0);
  if (!Number.isFinite(next)) return res.status(400).json({ error: 'Invalid value' });
  counts[channelId] = Math.max(0, Math.round(next));
  writeJson(QUEUE_FILE, counts);
  res.json({ limit: QUEUE_LIMIT, counts });
});

// ---------- Riwayat publish (endpoint baru) ----------
app.get('/api/history', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const entries = readJson(HISTORY_FILE, []);
  res.json({ entries: entries.slice(0, limit) });
});

// Body: { filename, videoUrl, brief, results: [{ channelId, ok, error }] }
app.post('/api/history', (req, res) => {
  const { filename, videoUrl, brief, results } = req.body || {};
  if (!Array.isArray(results)) return res.status(400).json({ error: 'results must be an array' });

  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    filename: filename || '',
    videoUrl: videoUrl || '',
    brief: brief || '',
    results: results.map(r => {
      const channel = channels.find(c => c.id === r.channelId);
      return {
        channelId: r.channelId,
        label: channel?.label || r.label || r.channelId,
        platform: channel?.platform || r.platform || '',
        ok: !!r.ok,
        error: r.ok ? null : (r.error || null),
        at: new Date().toISOString()
      };
    })
  };

  const entries = readJson(HISTORY_FILE, []);
  entries.unshift(entry);
  writeJson(HISTORY_FILE, entries.slice(0, 500));

  // Publish yang sukses menambah 1 slot antrian di channel tersebut.
  const counts = readQueue();
  for (const r of entry.results) if (r.ok) counts[r.channelId] = (counts[r.channelId] || 0) + 1;
  writeJson(QUEUE_FILE, counts);

  res.json({ entry, limit: QUEUE_LIMIT, counts });
});

// Update hasil 1 channel di entry yang sudah ada (dipakai setelah Retry).
// Body: { channelId, ok, error }
app.post('/api/history/:id/result', (req, res) => {
  const { channelId, ok, error } = req.body || {};
  const entries = readJson(HISTORY_FILE, []);
  const entry = entries.find(e => e.id === req.params.id);
  if (!entry) return res.status(404).json({ error: 'History entry not found' });

  const channel = channels.find(c => c.id === channelId);
  const existing = entry.results.find(r => r.channelId === channelId);
  const wasOk = !!existing?.ok;
  const patch = {
    channelId,
    label: channel?.label || channelId,
    platform: channel?.platform || '',
    ok: !!ok,
    error: ok ? null : (error || null),
    at: new Date().toISOString()
  };
  if (existing) Object.assign(existing, patch);
  else entry.results.push(patch);
  writeJson(HISTORY_FILE, entries);

  const counts = readQueue();
  if (!wasOk && ok) counts[channelId] = (counts[channelId] || 0) + 1;
  writeJson(QUEUE_FILE, counts);

  res.json({ entry, limit: QUEUE_LIMIT, counts });
});

app.listen(PORT, () => console.log(`video-post-app listening on port ${PORT}`));

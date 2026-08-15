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

app.listen(PORT, () => console.log(`video-post-app listening on port ${PORT}`));

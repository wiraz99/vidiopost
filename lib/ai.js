/**
 * Panggilan ke Hermes (endpoint chat-completions OpenAI-compatible).
 * Semua prompt minta balasan JSON, dan parsernya sengaja pemaaf karena
 * model sering membungkus jawaban dengan ```json atau kalimat pembuka.
 */
const fetch = require('node-fetch');

const HERMES_API_URL = process.env.HERMES_API_URL;
const HERMES_API_KEY = process.env.HERMES_API_KEY || '';
// Endpoint OpenAI-compatible MEWAJIBKAN field `model`; tanpa itu balasannya
// "missing model". Default-nya "hermes" — nama combo di 9Router yang dipakai
// project ini. Ganti lewat HERMES_MODEL kalau nama combonya berubah.
const HERMES_MODEL = process.env.HERMES_MODEL || 'hermes';
const HERMES_MAX_TOKENS = Number(process.env.HERMES_MAX_TOKENS || 0);
const BRAND = process.env.BRAND_NAME || 'Arachynana';
const PRODUCT = process.env.BRAND_PRODUCT || 'Sale Pisang Granola';

class AIError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

/** Ambil JSON dari balasan model, walau terbungkus code fence atau basa-basi. */
function extractJson(text) {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.search(/[[{]/);
  if (start === -1) return null;
  const opener = candidate[start];
  const closer = opener === '{' ? '}' : ']';
  const end = candidate.lastIndexOf(closer);
  if (end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

async function ask(prompt, { temperature = 0.8 } = {}) {
  if (!HERMES_API_URL) throw new AIError('HERMES_API_URL belum diisi di .env', 500);

  const payload = {
    ...(HERMES_MODEL ? { model: HERMES_MODEL } : {}),
    ...(HERMES_MAX_TOKENS ? { max_tokens: HERMES_MAX_TOKENS } : {}),
    temperature,
    messages: [{ role: 'user', content: prompt }]
  };

  let res;
  try {
    res = await fetch(HERMES_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(HERMES_API_KEY ? { Authorization: `Bearer ${HERMES_API_KEY}` } : {})
      },
      body: JSON.stringify(payload)
    });
  } catch (err) {
    throw new AIError(`Tidak bisa menghubungi Hermes di ${HERMES_API_URL} — ${err.message}`);
  }

  const raw = await res.text();

  // Isi balasan JANGAN dibuang: di situlah alasan sebenarnya tertulis
  // (mis. "you must provide a model parameter").
  if (!res.ok) {
    let detail = raw.slice(0, 300);
    try {
      const parsed = JSON.parse(raw);
      detail = parsed.error?.message || parsed.message || parsed.detail || detail;
    } catch {
      // biarkan potongan mentahnya
    }
    const hint = res.status === 400 && !HERMES_MODEL
      ? ' — kemungkinan perlu mengisi HERMES_MODEL di environment variable'
      : res.status === 401 || res.status === 403
        ? ' — periksa HERMES_API_KEY'
        : res.status === 404
          ? ' — periksa HERMES_API_URL, apakah sudah termasuk /v1/chat/completions'
          : '';
    throw new AIError(`Hermes menolak (HTTP ${res.status}): ${detail}${hint}`);
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new AIError(`Balasan Hermes bukan JSON: ${raw.slice(0, 200)}`);
  }

  const text = data.choices?.[0]?.message?.content || data.content || '';
  if (!text) {
    throw new AIError(`Hermes membalas tanpa isi teks. Bentuk balasannya: ${JSON.stringify(data).slice(0, 250)}`);
  }
  return text;
}

/** Ringkasan setelan + satu panggilan uji, untuk mendiagnosis kalau AI tidak jalan. */
async function selfTest() {
  const config = {
    url: HERMES_API_URL || null,
    hasKey: !!HERMES_API_KEY,
    model: HERMES_MODEL || null,
    maxTokens: HERMES_MAX_TOKENS || null
  };
  if (!HERMES_API_URL) {
    return { ok: false, config, error: 'HERMES_API_URL belum diisi di environment variable.' };
  }
  try {
    const text = await ask('Balas dengan satu kata: OK', { temperature: 0 });
    return { ok: true, config, reply: text.slice(0, 120) };
  } catch (err) {
    return { ok: false, config, error: err.message };
  }
}

const context = (brief) =>
  `Brand: ${BRAND}. Produk: ${PRODUCT}. Bahasa: Indonesia santai, ramah, tidak kaku.\n` +
  `Konteks video: "${brief}".`;

/** Caption per platform. Mempertahankan bentuk balasan endpoint /api/caption yang lama. */
async function generateCaptions({ brief, platforms, title = '' }) {
  if (!platforms?.length) throw new AIError('platforms kosong', 400);

  const prompt = `${context(brief)}
${title ? `Judul video: "${title}".\n` : ''}
Buatkan caption media sosial terpisah untuk platform berikut: ${platforms.join(', ')}.
Sesuaikan gaya dan panjangnya dengan kebiasaan tiap platform:
- tiktok & instagram: hook kuat di kalimat pertama, singkat, ramah
- youtube: deskripsi lebih informatif, boleh beberapa kalimat
- facebook: hangat, mengajak ngobrol
- threads: sangat singkat, maksimal 2-3 kalimat
- pinterest: deskriptif, fokus manfaat produk, tanpa hashtag

JANGAN menyertakan hashtag apa pun — hashtag diurus terpisah.
Balas HANYA JSON valid, tanpa teks lain:
{ ${platforms.map((p) => `"${p}": "..."`).join(', ')} }`;

  const parsed = extractJson(await ask(prompt));
  if (!parsed || typeof parsed !== 'object') throw new AIError('Balasan Hermes tidak bisa dibaca sebagai JSON');

  const captions = {};
  for (const p of platforms) if (typeof parsed[p] === 'string') captions[p] = parsed[p].trim();
  return captions;
}

/** Usulan judul ber-SEO. Dipakai tombol "Sarankan judul" di halaman Stok. */
async function suggestTitles({ brief, count = 5, platform = 'youtube' }) {
  const prompt = `${context(brief)}

Buatkan ${count} usulan JUDUL untuk video ini, dioptimalkan untuk pencarian (SEO) di ${platform}.
Syarat:
- panjang 40-70 karakter
- taruh kata kunci penting di depan
- konkret dan menggugah, bukan clickbait berlebihan
- variasikan sudut pandang (manfaat, rasa penasaran, cara/tutorial, angka)
- tanpa tanda kutip dan tanpa hashtag

Balas HANYA array JSON string, tanpa teks lain:
["judul 1", "judul 2", ...]`;

  const parsed = extractJson(await ask(prompt, { temperature: 0.9 }));
  if (!Array.isArray(parsed)) throw new AIError('Balasan Hermes bukan daftar judul');
  return parsed.filter((t) => typeof t === 'string' && t.trim()).map((t) => t.trim()).slice(0, count);
}

/** Usulan hashtag untuk dijadikan set baru di halaman Hashtag. */
async function suggestHashtags({ brief, platform = 'instagram', count = 15 }) {
  const prompt = `${context(brief)}

Usulkan ${count} hashtag relevan untuk ${platform}.
Syarat:
- campur hashtag populer dan hashtag khusus/niche
- relevan dengan makanan ringan, camilan, dan produk lokal Indonesia
- satu kata per hashtag, format #TanpaSpasi
- tanpa duplikat

Balas HANYA array JSON string, tanpa teks lain:
["#contoh", "#contohDua", ...]`;

  const parsed = extractJson(await ask(prompt, { temperature: 0.9 }));
  if (!Array.isArray(parsed)) throw new AIError('Balasan Hermes bukan daftar hashtag');

  const seen = new Set();
  const out = [];
  for (const raw of parsed) {
    if (typeof raw !== 'string') continue;
    const tag = ('#' + raw.trim().replace(/^#+/, '')).replace(/\s+/g, '');
    if (tag.length < 2 || seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    out.push(tag);
  }
  return out.slice(0, count);
}

module.exports = {
  AIError,
  generateCaptions,
  suggestTitles,
  suggestHashtags,
  extractJson,
  selfTest,
  isConfigured: () => !!HERMES_API_URL
};

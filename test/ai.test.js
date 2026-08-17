const test = require('node:test');
const assert = require('node:assert');
const { parseCompletionBody, textFromCompletion, splitJsonObjects, extractJson } = require('../lib/ai');

const read = (raw) => textFromCompletion(parseCompletionBody(raw) || []);

const completion = (content, id = 'router-1') =>
  JSON.stringify({
    id,
    object: 'chat.completion',
    model: 'deepseek-v4-flash-free',
    choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }]
  });

// ---------- bentuk balasan ----------

test('JSON tunggal biasa', () => {
  assert.strictEqual(read(completion('Halo dunia')), 'Halo dunia');
});

test('beberapa objek JSON berurutan — bentuk yang bikin JSON.parse menyerah', () => {
  // Inilah yang dikirim router combo: dua balasan penuh nempel tanpa pemisah.
  const raw = completion('Jawaban pertama', 'router-a') + completion('Jawaban kedua', 'router-b');
  assert.throws(() => JSON.parse(raw), 'seharusnya memang tidak bisa di-JSON.parse langsung');
  // Diambil yang pertama, BUKAN disambung — menyambung dua jawaban penuh bikin teks campur aduk.
  assert.strictEqual(read(raw), 'Jawaban pertama');
});

test('objek berurutan dipisah baris baru (NDJSON)', () => {
  const raw = `${completion('Satu', 'a')}\n${completion('Dua', 'b')}\n`;
  assert.strictEqual(read(raw), 'Satu');
});

test('aliran SSE disambung berurutan', () => {
  const chunk = (c) => `data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}`;
  const raw = [chunk('Sale '), chunk('Pisang '), chunk('Granola'), 'data: [DONE]'].join('\n\n');
  assert.strictEqual(read(raw), 'Sale Pisang Granola');
});

test('SSE dengan potongan rusak tetap terbaca', () => {
  const raw = [
    `data: ${JSON.stringify({ choices: [{ delta: { content: 'Ren' } }] })}`,
    'data: {rusak',
    `data: ${JSON.stringify({ choices: [{ delta: { content: 'yah' } }] })}`,
    'data: [DONE]'
  ].join('\n');
  assert.strictEqual(read(raw), 'Renyah');
});

test('bentuk lama choices[].text juga dikenali', () => {
  assert.strictEqual(read(JSON.stringify({ choices: [{ text: 'Teks lawas' }] })), 'Teks lawas');
});

test('balasan tanpa isi ditolak, bukan dikira kosong biasa', () => {
  const objects = parseCompletionBody(JSON.stringify({ choices: [{ message: { content: '' } }] }));
  assert.ok(objects, 'tetap bisa di-parse');
  assert.strictEqual(textFromCompletion(objects), '');
});

test('balasan yang benar-benar bukan JSON dikembalikan null', () => {
  assert.strictEqual(parseCompletionBody('<html>502 Bad Gateway</html>'), null);
  assert.strictEqual(parseCompletionBody(''), null);
});

// ---------- pemecah objek ----------

test('kurung kurawal di dalam string tidak mengecoh pemecah', () => {
  const raw = completion('Caption dengan { kurung } dan "tanda kutip" di dalamnya');
  assert.strictEqual(splitJsonObjects(raw).length, 1);
  assert.strictEqual(read(raw), 'Caption dengan { kurung } dan "tanda kutip" di dalamnya');
});

test('backslash sebelum tanda kutip tidak menutup string lebih awal', () => {
  const raw = JSON.stringify({ choices: [{ message: { content: 'pakai \\ backslash' } }] });
  assert.strictEqual(read(raw), 'pakai \\ backslash');
});

// ---------- pengambilan JSON dari isi jawaban ----------

test('JSON caption terbungkus code fence tetap terambil', () => {
  const inner = 'Tentu!\n```json\n{"tiktok":"Renyah!","youtube":"Deskripsi"}\n```\nSemoga membantu.';
  assert.deepStrictEqual(extractJson(inner), { tiktok: 'Renyah!', youtube: 'Deskripsi' });
});

test('daftar judul dengan basa-basi di depan tetap terambil', () => {
  assert.deepStrictEqual(extractJson('Ini usulannya:\n["Judul A","Judul B"]'), ['Judul A', 'Judul B']);
});

test('balasan tanpa JSON sama sekali mengembalikan null', () => {
  assert.strictEqual(extractJson('maaf saya tidak bisa membantu'), null);
});

// ---------- rangkaian penuh: balasan router combo -> caption per platform ----------

test('balasan bergaya 9Router terbaca sampai jadi caption per platform', () => {
  const raw = completion('```json\n{"tiktok":"Renyahnya juara!","pinterest":"Camilan sore"}\n```');
  assert.deepStrictEqual(extractJson(read(raw)), {
    tiktok: 'Renyahnya juara!',
    pinterest: 'Camilan sore'
  });
});

/**
 * Pengaturan.
 *
 * Yang dulu hanya bisa diubah dengan mengedit environment variable di Coolify
 * lalu deploy ulang seluruh aplikasi — tipe post Instagram, kategori YouTube,
 * privasi, board Pinterest, jam tayang, zona waktu — sekarang diatur di sini.
 *
 * Setelan berlaku dua lapis: yang umum dipakai semua channel, dan tiap channel
 * boleh menimpanya sendiri. Kolom yang dikosongkan berarti "ikut yang umum",
 * bukan "kosongkan nilainya".
 */
import * as api from '../api.js';
import {
  el, html, toast, busy, escapeHtml, platformDot, icon, button, setPageTitle
} from '../utils.js';
import { metaFor } from '../config.js';

// Kategori YouTube yang masuk akal untuk konten pendek. Angkanya id resmi
// YouTube; mengetik id mentah gampang salah, jadi disediakan namanya.
const KATEGORI_YOUTUBE = [
  ['26', 'Howto & Style'], ['22', 'People & Blogs'], ['24', 'Entertainment'],
  ['27', 'Education'], ['23', 'Comedy'], ['10', 'Music'], ['19', 'Travel & Events'],
  ['28', 'Science & Technology'], ['25', 'News & Politics'], ['15', 'Pets & Animals'],
  ['17', 'Sports'], ['20', 'Gaming'], ['1', 'Film & Animation'], ['29', 'Nonprofits & Activism']
];

const LABEL_PRIVASI = { public: 'Publik', unlisted: 'Tidak terdaftar', private: 'Privat' };
const LABEL_TIPE = { reel: 'Reel', post: 'Post biasa', story: 'Story' };

let data = null;
let view = null;

export async function render(container) {
  view = container;
  setPageTitle('Pengaturan');
  view.append(el('p', 'empty', 'Memuat pengaturan…'));
  await muat();
}

async function muat() {
  try {
    data = await api.getSettings();
  } catch (err) {
    view.innerHTML = '';
    view.append(el('div', 'alert alert-bad', `Gagal memuat pengaturan: ${err.message}`));
    return;
  }
  gambar();
}

function gambar() {
  view.innerHTML = '';
  const page = el('div', 'stack');

  page.append(html('div', 'page-head', `
    <div>
      <h2 class="page-title">Pengaturan</h2>
      <p class="page-sub">
        Berlaku langsung tanpa deploy ulang. Setelan channel menimpa setelan umum.
      </p>
    </div>
  `));

  page.append(panelUmum());
  page.append(panelChannel());
  page.append(panelServer());

  view.append(page);
}

// ================= setelan umum =================

function panelUmum() {
  const panel = html('section', 'panel', `
    <div class="panel-title">Umum</div>
    <p class="hint">Dipakai semua channel, kecuali channel itu punya setelannya sendiri.</p>
  `);

  const grid = el('div', 'field-row cols-2');

  grid.append(fieldSelect({
    label: 'Zona waktu',
    keterangan: 'Menentukan arti jam tayang. Buffer menerima UTC; konversinya diurus aplikasi.',
    value: data.umum.timezone,
    options: data.pilihan.timezones.map((z) => [z, z]),
    onSave: (v) => simpanUmum({ timezone: v })
  }));

  grid.append(fieldSelect({
    label: 'Tipe post Instagram',
    keterangan: 'Pakai "Post biasa" kalau videonya bukan vertikal atau lebih dari 90 detik.',
    value: data.umum.instagramType,
    options: data.pilihan.postTypes.map((t) => [t, LABEL_TIPE[t] || t]),
    onSave: (v) => simpanUmum({ instagramType: v })
  }));

  grid.append(fieldSelect({
    label: 'Tipe post Facebook',
    value: data.umum.facebookType,
    options: data.pilihan.postTypes.map((t) => [t, LABEL_TIPE[t] || t]),
    onSave: (v) => simpanUmum({ facebookType: v })
  }));

  grid.append(fieldSelect({
    label: 'Kategori YouTube',
    value: String(data.umum.youtubeCategoryId),
    options: kategoriOptions(data.umum.youtubeCategoryId),
    onSave: (v) => simpanUmum({ youtubeCategoryId: v })
  }));

  grid.append(fieldSelect({
    label: 'Privasi YouTube',
    value: data.umum.youtubePrivacy,
    options: data.pilihan.youtubePrivacy.map((p) => [p, LABEL_PRIVASI[p] || p]),
    onSave: (v) => simpanUmum({ youtubePrivacy: v })
  }));

  panel.append(grid);

  const feed = el('label', 'chip' + (data.umum.instagramShareToFeed ? ' on' : ''));
  const cb = el('input');
  cb.type = 'checkbox';
  cb.checked = !!data.umum.instagramShareToFeed;
  cb.onchange = async () => {
    feed.classList.toggle('on', cb.checked);
    await simpanUmum({ instagramShareToFeed: cb.checked });
  };
  feed.append(cb, el('span', null, 'Reel Instagram ikut tampil di feed'));

  const bungkus = el('div', 'field');
  bungkus.append(feed);
  panel.append(bungkus);

  return panel;
}

function kategoriOptions(current) {
  const daftar = KATEGORI_YOUTUBE.map(([id, nama]) => [id, `${nama} (${id})`]);
  // Kalau env memakai id di luar daftar, jangan sampai diam-diam berubah.
  if (current && !daftar.some(([id]) => id === String(current))) {
    daftar.unshift([String(current), `Kategori ${current}`]);
  }
  return daftar;
}

async function simpanUmum(patch) {
  try {
    const hasil = await api.saveSettings(patch);
    data.umum = hasil.umum;
    data.tersimpan = hasil.tersimpan;
    toast('Tersimpan.', 'ok');
  } catch (err) {
    toast(`Gagal menyimpan: ${err.message}`, 'bad');
    await muat();
  }
}

// ================= setelan per channel =================

function panelChannel() {
  const panel = html('section', 'panel', `
    <div class="panel-title">Per channel</div>
    <p class="hint">Kosongkan sebuah pilihan untuk ikut setelan umum di atas.</p>
  `);

  if (data.channelProblem) {
    panel.append(html('div', 'alert alert-bad',
      `Daftar channel belum bisa dibaca: ${escapeHtml(data.channelProblem)}`));
    return panel;
  }
  if (!data.channels.length) {
    panel.append(el('p', 'empty', 'Belum ada channel yang terbaca dari Buffer.'));
    return panel;
  }

  for (const channel of data.channels) panel.append(kartuChannel(channel));
  return panel;
}

function kartuChannel(channel) {
  const box = el('div', 'item');

  const head = el('button', 'item-head');
  head.type = 'button';
  const chev = icon('chevronDown', 15);
  chev.classList.add('item-chev');

  const main = el('span', 'item-main');
  main.append(el('span', 'item-title truncate', channel.label));

  const sub = el('span', 'item-sub truncate');
  const khusus = Object.keys(channel.tersimpan).length;
  sub.append(el('span', 'item-channel', `${metaFor(channel.platform).name} · akun ${channel.account}`));
  sub.append(el('span', null, khusus ? ` — ${khusus} setelan sendiri` : ' — ikut setelan umum'));
  main.append(sub);

  const meta = el('span', 'item-meta');
  meta.append(el('span', 'item-time tnum', channel.efektif.hour || '—'));
  head.append(chev, platformDot(channel.platform), main, meta);
  box.append(head);

  const body = el('div', 'item-body');
  body.hidden = true;
  box.append(body);

  head.onclick = () => {
    const buka = body.hidden;
    body.hidden = !buka;
    box.classList.toggle('open', buka);
    if (buka && !body.childElementCount) isiChannel(channel, body);
  };

  return box;
}

function isiChannel(channel, body) {
  const simpan = async (patch) => {
    try {
      const hasil = await api.setChannelSettings(channel.id, patch);
      channel.tersimpan = hasil.settings;
      channel.efektif = hasil.efektif;
      toast('Tersimpan.', 'ok');
    } catch (err) {
      toast(`Gagal menyimpan: ${err.message}`, 'bad');
    }
  };

  const grid = el('div', 'field-row cols-2');

  const jam = el('div', 'field');
  jam.append(el('label', 'lbl', 'Jam tayang bawaan'));
  const input = el('input');
  input.type = 'time';
  input.value = channel.efektif.hour || '';
  input.onchange = () => simpan({ hour: input.value });
  jam.append(input);
  jam.append(el('p', 'note', 'Dipakai saat menyusun jadwal baru. Kosongkan untuk memakai giliran otomatis.'));
  grid.append(jam);

  if (channel.platform === 'instagram') {
    grid.append(fieldSelect({
      label: 'Tipe post',
      value: channel.tersimpan.instagramType || '',
      options: [['', `Ikut umum (${LABEL_TIPE[data.umum.instagramType]})`],
        ...data.pilihan.postTypes.map((t) => [t, LABEL_TIPE[t] || t])],
      onSave: (v) => simpan({ instagramType: v })
    }));
  }
  if (channel.platform === 'facebook') {
    grid.append(fieldSelect({
      label: 'Tipe post',
      value: channel.tersimpan.facebookType || '',
      options: [['', `Ikut umum (${LABEL_TIPE[data.umum.facebookType]})`],
        ...data.pilihan.postTypes.map((t) => [t, LABEL_TIPE[t] || t])],
      onSave: (v) => simpan({ facebookType: v })
    }));
  }
  if (channel.platform === 'youtube') {
    grid.append(fieldSelect({
      label: 'Kategori',
      value: channel.tersimpan.youtubeCategoryId || '',
      options: [['', `Ikut umum (${data.umum.youtubeCategoryId})`], ...kategoriOptions(null)],
      onSave: (v) => simpan({ youtubeCategoryId: v })
    }));
    grid.append(fieldSelect({
      label: 'Privasi',
      value: channel.tersimpan.youtubePrivacy || '',
      options: [['', `Ikut umum (${LABEL_PRIVASI[data.umum.youtubePrivacy]})`],
        ...data.pilihan.youtubePrivacy.map((p) => [p, LABEL_PRIVASI[p] || p])],
      onSave: (v) => simpan({ youtubePrivacy: v })
    }));
  }

  body.append(grid);

  if (channel.platform === 'pinterest') body.append(boardPicker(channel, simpan));
}

/** Board Pinterest — wajib ada, tanpa itu Buffer menolak pin-nya. */
function boardPicker(channel, simpan) {
  const wrap = el('div', 'field');

  const head = el('div', 'row-between');
  head.append(el('label', 'lbl', 'Board tujuan'));
  const reload = button('btn btn-ghost btn-sm', 'refresh', 'Muat ulang');
  head.append(reload);
  wrap.append(head);

  const select = el('select');
  select.disabled = true;
  select.append(el('option', null, 'Memuat…'));
  wrap.append(select);

  const note = el('p', 'note');
  wrap.append(note);

  const load = async (force) => {
    const done = force ? busy(reload, 'Memuat…') : null;
    select.disabled = true;
    select.innerHTML = '';
    select.append(el('option', null, 'Memuat…'));
    try {
      const { boards, selected, problem } = await api.getChannelBoards(channel.id, force);
      select.innerHTML = '';

      if (problem || !boards.length) {
        select.append(el('option', null, 'Tidak bisa dibaca'));
        note.className = 'note bad-text';
        note.innerHTML = problem
          ? escapeHtml(problem)
          : 'Belum ada board terbaca. Kalau baru dibuat, tekan <b>Muat ulang</b>; kalau tetap kosong, ' +
            'putuskan lalu sambungkan ulang channel Pinterest di Buffer.';
        return;
      }

      select.append(Object.assign(el('option', null, '— belum dipilih —'), { value: '' }));
      for (const b of boards) select.append(Object.assign(el('option', null, b.name), { value: b.id }));
      select.value = selected || '';
      select.disabled = false;

      const sync = () => {
        note.className = select.value ? 'note' : 'note bad-text';
        note.textContent = select.value ? '' : 'Belum dipilih — pin ke Pinterest akan ditolak Buffer.';
      };
      sync();
      select.onchange = async () => { await simpan({ boardId: select.value }); sync(); };
    } catch (err) {
      select.innerHTML = '';
      select.append(el('option', null, 'Gagal memuat'));
      note.className = 'note bad-text';
      note.textContent = err.message;
    } finally {
      if (done) done();
    }
  };

  reload.onclick = () => load(true);
  load(false);
  return wrap;
}

// ================= server =================

function panelServer() {
  const s = data.server;
  const panel = html('section', 'panel', `
    <div class="panel-title">Server</div>
    <p class="hint">
      Yang di bawah ini milik server, bukan setelan per akun — mengubahnya tetap lewat
      environment variable lalu deploy ulang.
    </p>
  `);

  if (s.publicBaseUrlLooksLocal) {
    panel.append(html('div', 'alert alert-bad', `
      <b>PUBLIC_BASE_URL sepertinya belum benar.</b>
      <div style="margin-top:5px">
        Nilainya sekarang <code>${escapeHtml(s.publicBaseUrl || '(kosong)')}</code>.
        Buffer mengunduh video dari alamat ini, jadi kalau tidak bisa dibuka dari internet
        semua pengiriman akan gagal dengan "Video could not be read from its URL".
      </div>
    `));
  }

  const baris = [
    ['URL publik', s.publicBaseUrl || '(kosong)'],
    ['Folder media', s.mediaDir],
    ['Folder data', s.dataDir],
    ['Token Buffer A', s.bufferA ? 'terisi' : 'belum diisi'],
    ['Token Buffer B', s.bufferB ? 'terisi' : 'belum diisi'],
    ['AI (Hermes)', s.hermes ? `terisi · model "${s.hermesModel}"` : 'belum diisi']
  ];
  for (const [label, nilai] of baris) {
    const row = el('div', 'mrow');
    row.append(el('span', 'mlabel', label));
    const v = el('span', 'srv-value');
    v.textContent = nilai;
    if (/belum diisi|\(kosong\)/.test(nilai)) v.classList.add('bad-text');
    row.append(v);
    panel.append(row);
  }

  const aksi = el('div', 'row');
  aksi.style.marginTop = 'var(--s4)';

  const uji = button('btn btn-ghost btn-sm', 'sparkles', 'Uji koneksi AI');
  uji.onclick = async (e) => {
    const done = busy(e.currentTarget, 'Menguji…');
    try {
      const hasil = await api.testAI();
      toast(hasil.ok ? `AI menjawab: ${String(hasil.sample || 'ok').slice(0, 60)}` : (hasil.error || 'Gagal'),
        hasil.ok ? 'ok' : 'bad');
    } catch (err) {
      toast(`Gagal: ${err.message}`, 'bad');
    } finally {
      done();
    }
  };
  aksi.append(uji);

  if (data.usage) {
    aksi.append(el('span', 'muted',
      `Kuota API Buffer hari ini: ${data.usage.dayCount}/${data.usage.dayLimit} request.`));
  }
  panel.append(aksi);

  return panel;
}

// ================= komponen kecil =================

function fieldSelect({ label, keterangan, value, options, onSave }) {
  const field = el('div', 'field');
  field.append(el('label', 'lbl', label));

  const select = el('select');
  for (const [nilai, teks] of options) {
    select.append(Object.assign(el('option', null, teks), { value: nilai }));
  }
  select.value = value ?? '';
  select.onchange = () => onSave(select.value);
  field.append(select);

  if (keterangan) field.append(el('p', 'note', keterangan));
  return field;
}

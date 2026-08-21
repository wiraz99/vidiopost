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

async function muat(refresh = false) {
  try {
    data = await api.getSettings(refresh);
    // Channel yang disambungkan ulang di Buffer dapat ID baru, jadi setelan
    // lamanya menggantung. Ini yang mendeteksinya.
    data.yatim = await api.getOrphanChannels().then((r) => r.temuan).catch(() => []);
    // Status sesi datang dari endpoint terpisah; kalau gagal, panel keamanan
    // tetap tampil, cuma tanpa nama penggunanya.
    data.sesi = await api.authStatus().catch(() => null);
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
  page.append(panelKeamanan());
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
    <div class="row-between" id="kepalaChannel">
      <div>
        <div class="panel-title" style="margin:0">Per channel</div>
        <p class="hint" style="margin:4px 0 0">Kosongkan sebuah pilihan untuk ikut setelan umum di atas.</p>
      </div>
    </div>
  `);

  // Daftar channel di-cache 1 jam DAN tersimpan di volume permanen, jadi deploy
  // ulang pun tidak menyegarkannya. Tanpa tombol ini, channel yang baru
  // disambungkan ulang di Buffer tidak muncul sampai cachenya kedaluwarsa.
  const muatUlang = button('btn btn-ghost btn-sm', 'refresh', 'Muat ulang channel');
  muatUlang.onclick = async (e) => {
    const done = busy(e.currentTarget, 'Mengambil…');
    try {
      await muat(true);
      toast('Daftar channel diambil ulang dari Buffer.', 'ok');
    } catch (err) {
      toast('Gagal: ' + err.message, 'bad');
      done();
    }
  };
  panel.querySelector('#kepalaChannel').append(muatUlang);

  const umur = data.usage?.cache?.channelUmurMenit;
  if (umur != null) {
    panel.append(el('p', 'note', 'Daftar channel terakhir diambil ' + umur + ' menit lalu.'));
  }

  for (const y of data.yatim || []) panel.append(kartuYatim(y));

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

/**
 * Tawaran memindahkan setelan channel yang disambungkan ulang.
 * Sengaja menunggu persetujuan: menebak pengganti yang salah berarti setelan
 * nyasar ke channel lain tanpa disadari.
 */
function kartuYatim(y) {
  const box = el('div', 'alert alert-warn');
  const isi = el('div');

  isi.append(html('div', null,
    '<b>' + escapeHtml(y.lama.label) + '</b> sepertinya disambungkan ulang di Buffer, jadi ID-nya berubah.'));

  const rincian = [];
  if (y.punyaSetelan) rincian.push('setelan channel (board / jam tayang)');
  if (y.itemBelumTerkirim) rincian.push(y.itemBelumTerkirim + ' item jadwal yang belum terkirim');
  if (rincian.length) {
    isi.append(el('p', 'note', 'Yang masih menunjuk ID lama: ' + rincian.join(' dan ') + '.'));
  }

  if (!y.kandidat.length) {
    isi.append(el('p', 'note',
      'Belum ada channel pengganti yang cocok. Tekan "Muat ulang channel" dulu; kalau tetap ' +
      'kosong, pastikan channelnya memang sudah tersambung lagi di Buffer.'));
    box.append(isi);
    return box;
  }

  const baris = el('div', 'row');
  baris.style.marginTop = '8px';

  const pilih = el('select');
  pilih.style.maxWidth = '260px';
  for (const k of y.kandidat) {
    pilih.append(Object.assign(el('option', null, k.label), { value: k.id }));
  }

  const pindah = button('btn btn-ghost btn-sm', 'arrowRight', 'Pindahkan setelannya');
  pindah.onclick = async (e) => {
    const tujuan = y.kandidat.find((k) => k.id === pilih.value);
    const setuju = confirm(
      'Pindahkan setelan dan jadwal yang belum terkirim dari "' + y.lama.label +
      '" ke "' + tujuan.label + '"?\n\nItem yang sudah terkirim tidak diubah.'
    );
    if (!setuju) return;

    const done = busy(e.currentTarget, 'Memindahkan…');
    try {
      const hasil = await api.migrateChannel(y.lama.id, pilih.value);
      const bagian = [];
      if (hasil.setelanPindah) bagian.push('setelan dipindah');
      if (hasil.diubah) bagian.push(hasil.diubah + ' item jadwal dialihkan');
      toast('Selesai' + (bagian.length ? ': ' + bagian.join(', ') : '') + '.', 'ok');
      await muat(true);
    } catch (err) {
      toast('Gagal memindahkan: ' + err.message, 'bad');
      done();
    }
  };

  baris.append(pilih, pindah);
  isi.append(baris);

  if (!y.yakin) {
    isi.append(el('p', 'note', 'Ada lebih dari satu kemungkinan — pastikan kamu memilih yang benar.'));
  }

  box.append(isi);
  return box;
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
      const { boards, selected, problem, channelAda } = await api.getChannelBoards(channel.id, force);
      select.innerHTML = '';

      if (problem || !boards.length) {
        select.append(el('option', null, 'Tidak bisa dibaca'));
        note.className = 'note bad-text';

        if (problem) {
          note.innerHTML = escapeHtml(problem);
        } else if (channelAda === false) {
          // Menyuruh "sambungkan ulang" di sini justru salah — itu penyebabnya.
          note.innerHTML =
            'Channel ini <b>sudah tidak ada di Buffer</b>. Biasanya karena diputus lalu ' +
            'disambungkan ulang, sehingga Buffer memberi ID baru. Tekan ' +
            '<b>Muat ulang channel</b> di atas, lalu pindahkan setelannya ke channel yang baru.';
        } else {
          note.innerHTML =
            'Channelnya ada, tapi belum ada board yang terbaca. Kalau boardnya baru dibuat, ' +
            'tekan <b>Muat ulang</b> — Buffer kadang butuh beberapa menit menyinkronkannya.';
        }
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

// ================= keamanan =================

function panelKeamanan() {
  const panel = html('section', 'panel', `
    <div class="panel-title">Keamanan</div>
    <p class="hint">
      Halaman ini bisa mengirim post ke semua akun sosial mediamu, jadi aksesnya dikunci.
    </p>
  `);

  panel.append(html('div', 'mrow', `
    <span class="mlabel">Masuk sebagai</span>
    <span class="srv-value">${escapeHtml(data.sesi?.user || '—')}</span>
  `));

  const form = el('div', 'field-row cols-2');
  form.style.marginTop = 'var(--s4)';

  const lama = kolomSandi('Kata sandi sekarang', 'current-password');
  const baru = kolomSandi('Kata sandi baru', 'new-password');
  const ulang = kolomSandi('Ulangi kata sandi baru', 'new-password');
  form.append(lama.field, baru.field, ulang.field);
  panel.append(form);

  const ganti = button('btn btn-ghost', 'lock', 'Ganti kata sandi');
  ganti.onclick = async (e) => {
    if (baru.input.value !== ulang.input.value) return toast('Ulangan kata sandinya belum sama.', 'bad');
    if (baru.input.value.length < 8) return toast('Kata sandi baru minimal 8 karakter.', 'bad');

    const done = busy(e.currentTarget, 'Mengganti…');
    try {
      await api.changePassword({ lama: lama.input.value, baru: baru.input.value });
      for (const k of [lama, baru, ulang]) k.input.value = '';
      toast('Kata sandi diganti. Perangkat lain yang masih terbuka akan diminta masuk lagi.', 'ok');
    } catch (err) {
      toast(`Gagal: ${err.message}`, 'bad');
    } finally {
      done();
    }
  };
  panel.append(ganti);

  panel.append(el('p', 'note',
    'Mengganti kata sandi membatalkan semua sesi yang masih terbuka di perangkat lain. ' +
    'Sandi yang diganti di sini menimpa AUTH_PASSWORD dari environment, jadi tidak perlu deploy ulang.'));

  panel.append(html('div', 'alert alert-info', `
    <div>
      <b>Folder video sengaja tetap terbuka.</b>
      <div style="margin-top:5px">
        Buffer mengunduh videonya dari <code>/media/…</code> tanpa login, jadi bagian itu tidak bisa
        dikunci tanpa membuat semua pengiriman gagal. Yang melindunginya adalah nama file berisi
        bagian acak, sehingga alamatnya tidak bisa ditebak.
      </div>
      <div style="margin-top:5px">
        Video yang diupload <b>sebelum</b> versi ini masih memakai nama lama yang mudah ditebak.
        Namanya tidak diganti otomatis karena post yang sudah terjadwal di Buffer menyimpan
        alamat lamanya — menggantinya akan bikin gagal tayang. Hapus dan upload ulang kalau
        video itu memang perlu dirahasiakan.
      </div>
    </div>
  `));

  return panel;
}

function kolomSandi(label, autocomplete) {
  const field = el('div', 'field');
  field.append(el('label', 'lbl', label));
  const input = el('input');
  input.type = 'password';
  input.autocomplete = autocomplete;
  field.append(input);
  return { field, input };
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

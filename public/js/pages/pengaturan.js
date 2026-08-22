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

  page.append(panelGrup());
  page.append(panelUmum());
  page.append(panelChannel());
  page.append(panelKeamanan());
  page.append(panelServer());

  view.append(page);
}

// ================= grup =================

/**
 * Grup memisahkan brand: video, channel, hashtag dan tautan milik satu grup
 * tidak akan pernah bisa tercampur dengan grup lain.
 *
 * Halaman ini sengaja melihat SEMUA grup sekaligus (bukan cuma yang sedang
 * aktif) — di sinilah channel ditetapkan grupnya, jadi menyaringnya justru
 * membuat channel yang belum bergrup mustahil diperbaiki.
 */
function panelGrup() {
  const panel = html('section', 'panel', `
    <div class="panel-title">Grup</div>
    <p class="hint">
      Satu grup = satu brand. Nama brand di sini yang dipakai AI saat menulis caption dan judul.
      Pindah antar grup lewat pemilih di pojok kiri atas.
    </p>
  `);

  const belum = data.channels.filter((c) => !c.groupId);
  if (belum.length) panel.append(kartuTanpaGrup(belum));

  for (const g of data.groups || []) panel.append(kartuGrup(g));

  panel.append(formGrupBaru());
  return panel;
}

/**
 * Channel tanpa grup. Ini keadaan yang HARUS mencolok: channel seperti ini
 * tidak masuk grup mana pun, jadi tidak muncul di halaman jadwal sama sekali.
 * Itu disengaja — supaya channel brand baru tidak diam-diam ikut menerima
 * konten brand lama — tapi diamnya harus dijelaskan, bukan dibiarkan.
 */
function kartuTanpaGrup(belum) {
  const box = el('div', 'alert alert-warn');
  const isi = el('div', 'grow');

  isi.append(html('div', null,
    `<b>${belum.length} channel belum punya grup</b> — belum bisa dipakai menjadwalkan apa pun.`));

  for (const channel of belum) {
    const baris = el('div', 'row');
    baris.style.marginTop = '8px';

    const label = el('span', 'grow truncate');
    label.append(platformDot(channel.platform), el('span', null, ' ' + channel.label));

    const pilih = el('select');
    pilih.style.maxWidth = '200px';
    pilih.append(Object.assign(el('option', null, '— pilih grup —'), { value: '' }));
    for (const g of data.groups || []) {
      pilih.append(Object.assign(el('option', null, g.name), { value: g.id }));
    }

    const simpan = button('btn btn-ghost btn-sm', 'check', 'Tetapkan');
    simpan.onclick = async (e) => {
      if (!pilih.value) return toast('Pilih grupnya dulu.', 'bad');
      const done = busy(e.currentTarget, 'Menetapkan…');
      try {
        await api.assignChannels(pilih.value, [channel.id]);
        toast(`${channel.label} masuk grup yang dipilih.`, 'ok');
        document.dispatchEvent(new CustomEvent('grup-diubah'));
        await muat();
      } catch (err) {
        toast('Gagal: ' + err.message, 'bad');
        done();
      }
    };

    baris.append(label, pilih, simpan);
    isi.append(baris);
  }

  box.append(isi);
  return box;
}

function kartuGrup(g) {
  const box = el('div', 'item');

  const head = el('button', 'item-head');
  head.type = 'button';
  const chev = icon('chevronDown', 15);
  chev.classList.add('item-chev');

  const tanda = el('span', 'brand-mark sm');
  tanda.textContent = (g.name || '?').charAt(0).toUpperCase();
  if (g.warna) tanda.style.background = g.warna;

  const main = el('span', 'item-main');
  main.append(el('span', 'item-title truncate', g.name + (g.isDefault ? ' · bawaan' : '')));

  const isi = g.isi || {};
  const bagian = [
    [isi.channel, 'channel'], [isi.video, 'video'], [isi.jadwal, 'jadwal'],
    [isi.hashtag, 'set hashtag'], [isi.tautan, 'tautan']
  ].filter(([n]) => n > 0).map(([n, nama]) => `${n} ${nama}`);

  main.append(el('span', 'item-sub truncate', bagian.length ? bagian.join(' · ') : 'masih kosong'));
  head.append(chev, tanda, main);
  box.append(head);

  const body = el('div', 'item-body');
  body.hidden = true;
  box.append(body);

  head.onclick = () => {
    const buka = body.hidden;
    body.hidden = !buka;
    box.classList.toggle('open', buka);
    if (buka && !body.childElementCount) isiGrup(g, body);
  };

  return box;
}

function isiGrup(g, body) {
  const simpan = async (patch) => {
    try {
      const hasil = await api.updateGroup(g.id, patch);
      Object.assign(g, hasil.group);
      toast('Tersimpan.', 'ok');
      document.dispatchEvent(new CustomEvent('grup-diubah'));
    } catch (err) {
      toast(`Gagal menyimpan: ${err.message}`, 'bad');
    }
  };

  const grid = el('div', 'field-row cols-2');
  grid.append(fieldTeks({
    label: 'Nama grup',
    keterangan: 'Yang muncul di pemilih grup.',
    value: g.name,
    onSave: (v) => simpan({ name: v })
  }));
  grid.append(fieldTeks({
    label: 'Nama brand untuk AI',
    keterangan: 'Dipakai di prompt caption & judul. Biasanya sama dengan nama grup.',
    value: g.brand || '',
    onSave: (v) => simpan({ brand: v })
  }));
  grid.append(fieldTeks({
    label: 'Produk',
    keterangan: 'Contoh: "Sale Pisang Granola". Ini yang membuat caption tiap brand berbeda.',
    value: g.product || '',
    onSave: (v) => simpan({ product: v })
  }));
  body.append(grid);

  const warnaField = el('div', 'field');
  warnaField.append(el('label', 'lbl', 'Warna penanda'));
  const warna = el('input');
  warna.type = 'color';
  warna.value = g.warna || '#0f766e';
  warna.style.maxWidth = '90px';
  warna.onchange = () => simpan({ warna: warna.value });
  warnaField.append(warna);
  warnaField.append(el('p', 'note', 'Dipakai pada kotak inisial di pojok kiri atas.'));
  body.append(warnaField);

  // Channel milik grup ini, bisa dipindah dari sini.
  const milik = data.channels.filter((c) => c.groupId === g.id);
  const chField = el('div', 'field');
  chField.append(el('label', 'lbl', 'Channel di grup ini'));
  if (!milik.length) {
    chField.append(el('p', 'note', 'Belum ada. Tetapkan channel lewat daftar "Per channel" di bawah.'));
  }
  for (const channel of milik) {
    const baris = el('div', 'row');
    baris.style.marginTop = '6px';
    const label = el('span', 'grow truncate');
    label.append(platformDot(channel.platform), el('span', null, ' ' + channel.label));
    baris.append(label);
    chField.append(baris);
  }
  body.append(chField);

  const aksi = el('div', 'row');
  aksi.style.marginTop = 'var(--s4)';

  if (!g.isDefault) {
    const jadikan = button('btn btn-ghost btn-sm', 'check', 'Jadikan grup bawaan');
    jadikan.onclick = async () => { await simpan({ isDefault: true }); await muat(); };
    aksi.append(jadikan);
  }

  const hapus = button('btn btn-ghost btn-sm', 'trash', 'Hapus grup');
  hapus.classList.add('danger');
  hapus.onclick = async (e) => {
    if (!confirm(`Hapus grup "${g.name}"?`)) return;
    const done = busy(e.currentTarget, 'Menghapus…');
    try {
      await api.deleteGroup(g.id);
      toast('Grup dihapus.', 'ok');
      document.dispatchEvent(new CustomEvent('grup-diubah'));
      await muat();
    } catch (err) {
      // Server menolak selama grupnya masih dipakai, dan menyebut apa yang
      // menahannya — pesannya ditampilkan apa adanya karena itu yang berguna.
      toast(err.message, 'bad');
      done();
    }
  };
  aksi.append(hapus);
  body.append(aksi);
}

function formGrupBaru() {
  const box = el('div', 'field');
  box.style.marginTop = 'var(--s4)';

  const buka = button('btn btn-ghost btn-sm', 'plus', 'Tambah grup');
  box.append(buka);

  const form = el('div', 'field-row cols-2');
  form.hidden = true;
  form.style.marginTop = 'var(--s3)';

  const nama = el('input');
  nama.type = 'text';
  nama.placeholder = 'Nama grup, mis. Kopi Kita';
  const produk = el('input');
  produk.type = 'text';
  produk.placeholder = 'Produk, mis. Kopi Robusta';

  const bungkusNama = el('div', 'field');
  bungkusNama.append(el('label', 'lbl', 'Nama grup'), nama);
  const bungkusProduk = el('div', 'field');
  bungkusProduk.append(el('label', 'lbl', 'Produk'), produk);
  form.append(bungkusNama, bungkusProduk);

  const simpan = button('btn btn-primary btn-sm', 'check', 'Buat grup');
  simpan.style.marginTop = 'var(--s3)';
  simpan.hidden = true;

  buka.onclick = () => {
    form.hidden = !form.hidden;
    simpan.hidden = form.hidden;
    if (!form.hidden) nama.focus();
  };

  simpan.onclick = async (e) => {
    if (!nama.value.trim()) return toast('Nama grup wajib diisi.', 'bad');
    const done = busy(e.currentTarget, 'Membuat…');
    try {
      await api.createGroup({ name: nama.value.trim(), product: produk.value.trim() });
      toast('Grup dibuat. Tetapkan channelnya lewat daftar "Per channel".', 'ok');
      document.dispatchEvent(new CustomEvent('grup-diubah'));
      await muat();
    } catch (err) {
      toast('Gagal: ' + err.message, 'bad');
      done();
    }
  };

  box.append(form, simpan);
  return box;
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
  // groupId ikut terhitung sebagai "setelan sendiri" di data, tapi bukan setelan
  // tampilan — jadi tidak ikut dihitung supaya angkanya tidak membingungkan.
  const khusus = Object.keys(channel.tersimpan).filter((k) => k !== 'groupId').length;
  const grupNama = (data.groups || []).find((g) => g.id === channel.groupId)?.name;
  sub.append(el('span', 'item-channel', `${metaFor(channel.platform).name} · akun ${channel.account}`));
  sub.append(el('span', grupNama ? null : 'warn-text',
    grupNama ? ` · grup ${grupNama}` : ' · belum punya grup'));
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

  // Grup ditaruh paling depan: ini setelan yang menentukan channel ini boleh
  // menerima konten siapa, jadi bobotnya jauh di atas jam tayang.
  grid.append(fieldSelect({
    label: 'Grup pemilik',
    keterangan: 'Hanya video dan jadwal grup ini yang boleh dikirim ke channel ini.',
    value: channel.groupId || '',
    options: [
      ['', '— belum ditetapkan —'],
      ...(data.groups || []).map((g) => [g.id, g.name])
    ],
    onSave: async (v) => {
      await simpan({ groupId: v });
      document.dispatchEvent(new CustomEvent('grup-diubah'));
      await muat();
    }
  }));

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
            'disambungkan ulang, sehingga Buffer memberi ID baru. ' +
            'Daftar channel sudah disegarkan otomatis — tekan <b>Muat ulang channel</b> ' +
            'di atas untuk menampilkan channel barunya beserta tawaran memindahkan setelan.';
        } else {
          note.innerHTML =
            'Channelnya ada, tapi belum ada board yang terbaca. Kalau boardnya baru dibuat, ' +
            'tekan <b>Muat ulang</b> — Buffer kadang butuh beberapa menit menyinkronkannya.';
        }

        wrap.append(tombolPeriksa(channel));
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

/**
 * Kalau board tetap tidak terbaca, tebak-tebakan tidak menolong. Tombol ini
 * menanyakan langsung ke Buffer — tiap cara pembacaan dicoba dan balasannya
 * ditampilkan apa adanya, termasuk bentuk skema Pinterest menurut Buffer.
 */
function tombolPeriksa(channel) {
  const kotak = el('div');
  kotak.style.marginTop = '8px';

  const tombol = button('btn btn-ghost btn-sm', 'alert', 'Periksa kenapa');
  kotak.append(tombol);

  const hasil = el('pre', 'finaltext');
  hasil.hidden = true;
  kotak.append(hasil);

  tombol.onclick = async (e) => {
    const done = busy(e.currentTarget, 'Menanya Buffer…');
    try {
      const d = await api.diagnoseChannelBoards(channel.id);
      const baris = [];

      for (const j of d.jejak || []) {
        baris.push('cara: ' + j.cara);
        if (j.error) baris.push('  error   : ' + j.error);
        else {
          baris.push('  channel : ' + (j.channelAda ? 'ada' : 'TIDAK ADA'));
          baris.push('  board   : ' + j.jumlah);
          if (j.mentah) baris.push('  mentah  : ' + JSON.stringify(j.mentah));
        }
        baris.push('');
      }

      if (d.skema) {
        baris.push('field PinterestMetadata menurut Buffer:');
        baris.push('  ' + (d.skema.pinterestMetadata.join(', ') || '(tipe ini tidak ada)'));
        baris.push('tipe metadata channel yang dikenal:');
        baris.push('  ' + (d.skema.tipeMetadata.join(', ') || '-'));
      }
      if (d.skemaError) baris.push('skema gagal dibaca: ' + d.skemaError);

      hasil.textContent = baris.join('\n') || 'Buffer tidak mengembalikan keterangan apa pun.';
      hasil.hidden = false;
      done();
    } catch (err) {
      hasil.textContent = 'Gagal memeriksa: ' + err.message;
      hasil.hidden = false;
      done();
    }
  };

  return kotak;
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

/**
 * Kolom teks yang menyimpan sendiri. Sengaja disimpan saat FOKUSNYA LEPAS,
 * bukan tiap ketikan: nama grup yang tersimpan setengah jadi ("Kopi Ki") akan
 * langsung muncul di pemilih grup dan terlihat seperti kerusakan.
 */
function fieldTeks({ label, keterangan, value, onSave }) {
  const field = el('div', 'field');
  field.append(el('label', 'lbl', label));

  const input = el('input');
  input.type = 'text';
  input.value = value ?? '';
  input.onchange = () => {
    if (input.value === (value ?? '')) return;
    onSave(input.value);
  };
  field.append(input);

  if (keterangan) field.append(el('p', 'note', keterangan));
  return field;
}

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

/**
 * Isi satu jadwal.
 *
 * Perubahan terpenting dari versi sebelumnya: TIDAK ADA LAGI panel caption yang
 * terpisah dari daftar pengiriman.
 *
 * Dulu caption dikelompokkan per VIDEO di satu panel, sedangkan daftar kirim
 * dikelompokkan per VIDEO × CHANNEL di panel lain — dua struktur berbeda tanpa
 * penghubung, jadi saat melihat sebuah baris tidak ada cara tahu teks apa yang
 * akan terkirim. Sekarang tiap baris bisa dibuka di tempat, dan di dalamnya ada
 * captionnya, teks final yang benar-benar dikirim, waktunya, dan tombol kirim.
 *
 * Catatan yang harus jujur ditampilkan ke user: caption disimpan per
 * VIDEO + PLATFORM, sedangkan baris ini per VIDEO + CHANNEL. Jadi mengedit satu
 * caption bisa mengubah beberapa baris sekaligus kalau ada dua akun di platform
 * yang sama. Itu ditulis terang-terangan di panel yang terbuka.
 */
import * as api from '../api.js';
import {
  el, html, toast, busy, escapeHtml, formatDayLabel, formatRange, plusDaysISO,
  platformDot, attachCounter, icon, button, sleep, setPageTitle
} from '../utils.js';
import { limitsFor } from '../config.js';
import { renderPreview } from '../preview.js';

const STATE_LABEL = {
  sent: 'terkirim',
  error: 'gagal',
  kurang: 'belum lengkap',
  kedaluwarsa: 'sudah lewat',
  siap: 'siap'
};

const FILTERS = [
  { id: 'semua', label: 'Semua', match: () => true },
  { id: 'kurang', label: 'Belum lengkap', match: (i) => i.status !== 'sent' && i.missing.length },
  { id: 'siap', label: 'Siap', match: (i) => i.status !== 'sent' && i.ready },
  { id: 'gagal', label: 'Gagal', match: (i) => i.status === 'error' },
  { id: 'terkirim', label: 'Terkirim', match: (i) => i.status === 'sent' }
];

let view = null;
let plan = null;
let ringkas = null;
let videosById = new Map();
const expanded = new Set();
let filter = 'semua';

export async function render(container, planId) {
  view = container;
  expanded.clear();
  filter = 'semua';

  view.append(el('p', 'empty', 'Memuat jadwal…'));

  try {
    const [planRes, videoRes] = await Promise.all([api.getPlan(planId), api.listVideos()]);
    plan = planRes.plan;
    ringkas = planRes.ringkas;
    videosById = new Map(videoRes.videos.map((v) => [v.id, v]));
  } catch (err) {
    view.innerHTML = '';
    view.append(el('div', 'alert alert-bad', `Gagal memuat jadwal: ${err.message}`));
    return;
  }

  view.innerHTML = '';
  paintAll();
}

/** Ambil ulang dari server lalu gambar ulang, tanpa menutup baris yang terbuka. */
async function refresh() {
  const [planRes, videoRes] = await Promise.all([api.getPlan(plan.id), api.listVideos()]);
  plan = planRes.plan;
  ringkas = planRes.ringkas;
  videosById = new Map(videoRes.videos.map((v) => [v.id, v]));
  paintAll();
}

function paintAll() {
  view.innerHTML = '';
  setPageTitle(`Jadwal ${formatRange(ringkas.startDate, ringkas.endDate)}`);

  // Saringan yang isinya habis (mis. "gagal" setelah semuanya berhasil diulang)
  // akan hilang dari deretan chip — jangan tinggalkan daftar kosong tanpa sebab.
  const aktif = FILTERS.find((f) => f.id === filter);
  if (aktif && filter !== 'semua' && !plan.items.filter(aktif.match).length) filter = 'semua';

  const wrap = el('div', 'stack');
  wrap.append(headerPanel());
  wrap.append(filterBar());

  const list = el('div', 'stack', '');
  list.id = 'itemList';
  wrap.append(list);

  view.append(wrap);
  paintList();
}

// ================= header =================

function headerPanel() {
  const panel = el('section', 'panel');

  const top = el('div', 'page-head');
  const kiri = el('div');
  const back = el('a', 'backlink');
  back.href = '#/jadwal';
  back.textContent = 'Jadwal';
  kiri.append(back);
  kiri.append(el('h2', 'page-title', formatRange(ringkas.startDate, ringkas.endDate)));
  kiri.append(el('p', 'page-sub',
    `${ringkas.total} post · ${ringkas.videoCount} video × ${ringkas.channelCount} channel · ${plan.timezone}`));
  top.append(kiri);

  const kelola = button('btn btn-ghost btn-sm', 'refresh', 'Kelola');
  top.append(kelola);
  panel.append(top);

  // progres
  const track = el('div', 'progress');
  const bar = el('div', 'bar');
  bar.style.width = `${ringkas.total ? (ringkas.sent / ringkas.total) * 100 : 0}%`;
  if (ringkas.sent === ringkas.total) bar.style.background = 'var(--ok)';
  track.append(bar);
  panel.append(track);

  panel.append(el('p', 'muted tnum', `${ringkas.sent} dari ${ringkas.total} terkirim`));

  // aksi utama
  const aksi = el('div', 'row');
  aksi.style.marginTop = 'var(--s4)';

  const perluCaption = videoPerluCaption();
  if (perluCaption.length) {
    const gen = button('btn btn-ghost', 'sparkles', `Lengkapi caption (${perluCaption.length} video)`);
    gen.onclick = (e) => generateCaptions(e.currentTarget, perluCaption);
    aksi.append(gen);
  }

  const siap = plan.items.filter((i) => i.ready && i.status !== 'sent');
  const kirim = button('btn btn-primary', 'send', siap.length ? `Kirim ${siap.length} yang siap` : 'Tidak ada yang siap');
  kirim.disabled = !siap.length;
  kirim.onclick = (e) => sendItems(e.currentTarget, siap);
  aksi.append(kirim);

  const gagal = plan.items.filter((i) => i.status === 'error');
  if (gagal.length) {
    const retry = button('btn btn-ghost', 'refresh', `Ulangi ${gagal.length} yang gagal`);
    retry.onclick = (e) => sendItems(e.currentTarget, gagal);
    aksi.append(retry);
  }

  panel.append(aksi);

  // panel kelola: dipisah karena bukan jalur utama, tapi tetap sekali klik
  const kelolaBox = kelolaPanel();
  kelolaBox.hidden = true;
  panel.append(kelolaBox);
  kelola.onclick = () => { kelolaBox.hidden = !kelolaBox.hidden; };

  return panel;
}

function kelolaPanel() {
  const box = el('div', 'subcard');
  box.style.marginTop = 'var(--s4)';

  const geser = el('div', 'field');
  geser.append(el('label', 'lbl', 'Geser semua yang belum terkirim ke tanggal mulai baru'));

  const baris = el('div', 'row');
  const input = el('input');
  input.type = 'date';
  input.value = plusDaysISO(1);
  input.style.maxWidth = '170px';

  const btn = button('btn btn-ghost btn-sm', 'calendar', 'Jadwalkan ulang');
  btn.onclick = async (e) => {
    if (!input.value) return toast('Pilih tanggal mulai baru dulu.', 'bad');
    const done = busy(e.currentTarget, 'Menggeser…');
    try {
      const { diubah, dilewati, warning } = await api.reschedulePlan(plan.id, input.value);
      await refresh();
      toast(`${diubah} item digeser${dilewati ? `, ${dilewati} dilewati karena sudah terkirim` : ''}.`,
        warning ? 'bad' : 'ok');
      if (warning) toast(warning, 'bad');
    } catch (err) {
      toast(`Gagal menggeser: ${err.message}`, 'bad');
      done();
    }
  };

  baris.append(input, btn);
  geser.append(baris);
  geser.append(el('p', 'note', 'Pola rotasinya tetap: tiap item bertahan di hari ke-berapa dan jam yang sama.'));
  box.append(geser);

  // Buffer bisa gagal menayangkan SETELAH menerima post kita. Tanpa ini,
  // item yang sudah merah di Buffer tetap tertulis "terkirim" di sini.
  const sinkron = button('btn btn-ghost btn-sm', 'refresh', 'Periksa status di Buffer');
  sinkron.onclick = async (e) => {
    const done = busy(e.currentTarget, 'Menanya Buffer…');
    try {
      const hasil = await api.syncPlan(plan.id);
      await refresh();
      toast(
        hasil.berubah
          ? `${hasil.berubah} item ternyata berbeda dengan catatan Buffer.`
          : `${hasil.diperiksa} item diperiksa, semuanya cocok.`,
        hasil.berubah ? 'bad' : 'ok'
      );
      for (const c of hasil.catatan || []) toast(c, 'bad');
    } catch (err) {
      toast(`Gagal memeriksa: ${err.message}`, 'bad');
      done();
    }
  };

  const barisSinkron = el('div', 'field');
  barisSinkron.append(sinkron);
  barisSinkron.append(el('p', 'note',
    'Post yang diterima Buffer belum tentu berhasil tayang. Ini membaca status ' +
    'sebenarnya dari Buffer dan memperbaiki catatan di sini.'));
  box.append(barisSinkron);

  const hapus = button('btn btn-danger btn-sm', 'trash', 'Hapus jadwal ini');
  hapus.onclick = async () => {
    const pesan = ringkas.sent
      ? `Jadwal ini sudah punya ${ringkas.sent} post terkirim ke Buffer.\n` +
        'Menghapusnya di sini TIDAK membatalkan post yang sudah masuk Buffer.\n\nTetap hapus catatannya?'
      : 'Hapus jadwal ini? Video-videonya dikembalikan ke stok.';
    if (!confirm(pesan)) return;
    try {
      await api.deletePlan(plan.id);
      toast('Jadwal dihapus.', 'ok');
      location.hash = '/jadwal';
    } catch (err) {
      toast(`Gagal menghapus: ${err.message}`, 'bad');
    }
  };
  box.append(hapus);

  return box;
}

// ================= filter =================

function filterBar() {
  const bar = el('div', 'filterbar');
  for (const f of FILTERS) {
    const jumlah = plan.items.filter(f.match).length;
    if (f.id !== 'semua' && !jumlah) continue;

    const chip = el('button', `filterchip${filter === f.id ? ' on' : ''}`);
    chip.type = 'button';
    chip.append(el('span', null, f.label), el('span', 'filterchip-num', String(jumlah)));
    chip.onclick = () => {
      filter = f.id;
      paintAll();
    };
    bar.append(chip);
  }
  return bar;
}

// ================= daftar item =================

function paintList() {
  const list = view.querySelector('#itemList');
  list.innerHTML = '';

  const match = FILTERS.find((f) => f.id === filter)?.match || (() => true);
  const items = plan.items.filter(match);

  if (!items.length) {
    list.append(html('div', 'panel', '<p class="empty">Tidak ada item di saringan ini.</p>'));
    return;
  }

  for (const [date, harian] of groupByDay(items)) {
    const group = el('section', 'daygroup');

    const head = el('div', 'daygroup-head');
    head.append(el('span', 'daygroup-date', formatDayLabel(date)));
    const terkirim = harian.filter((i) => i.status === 'sent').length;
    head.append(el('span', 'daygroup-count',
      `${harian.length} post${terkirim ? ` · ${terkirim} terkirim` : ''}`));
    group.append(head);

    for (const item of harian) group.append(itemRow(item));
    list.append(group);
  }
}

function groupByDay(items) {
  const map = new Map();
  for (const item of items) {
    if (!map.has(item.date)) map.set(item.date, []);
    map.get(item.date).push(item);
  }
  return [...map.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([date, list]) => [date, list.slice().sort((a, b) => a.time.localeCompare(b.time))]);
}

function itemRow(item) {
  const box = el('div', `item item-${item.state}`);
  box.dataset.index = String(item.index);

  const head = el('button', 'item-head');
  head.type = 'button';
  head.setAttribute('aria-expanded', String(expanded.has(item.index)));

  const chev = icon('chevronDown', 15);
  chev.classList.add('item-chev');

  const main = el('span', 'item-main');
  main.append(el('span', 'item-title truncate', item.videoTitle));

  const sub = el('span', 'item-sub truncate');
  sub.append(el('span', 'item-channel', item.channelLabel));
  if (item.status !== 'sent' && item.missing.length) {
    sub.append(el('span', 'item-lack', `— ${item.missing[0]}`));
  } else if (item.preview) {
    sub.append(el('span', 'item-quote', `— “${item.preview}”`));
  }
  main.append(sub);

  // Jam & status ditumpuk di kanan supaya barisnya tetap utuh di layar 360px.
  const meta = el('span', 'item-meta');
  meta.append(el('span', 'item-time tnum', item.time));
  meta.append(el('span', `badge badge-${item.state}`, STATE_LABEL[item.state] || item.state));

  head.append(chev, platformDot(item.platform), main, meta);
  box.append(head);

  const body = el('div', 'item-body');
  body.hidden = !expanded.has(item.index);
  box.append(body);

  head.onclick = () => {
    const buka = body.hidden;
    body.hidden = !buka;
    head.setAttribute('aria-expanded', String(buka));
    box.classList.toggle('open', buka);
    if (buka) {
      expanded.add(item.index);
      if (!body.childElementCount) buildBody(item, body);
    } else {
      expanded.delete(item.index);
    }
  };

  if (expanded.has(item.index)) {
    box.classList.add('open');
    buildBody(item, body);
  }

  return box;
}

// ================= isi baris yang terbuka =================

function buildBody(item, body) {
  body.innerHTML = '';
  const video = videosById.get(item.videoId);

  // Channel yang disambungkan ulang di Buffer punya ID baru; item lama menunjuk
  // ID yang sudah mati dan pasti ditolak saat dikirim.
  if (item.channelMati) body.append(panelChannelMati(item));

  if (item.error) {
    body.append(html('div', 'alert alert-bad', `<b>Gagal dikirim:</b> ${escapeHtml(item.error)}`));
  }
  if (item.status !== 'sent' && item.missing.length) {
    body.append(html('div', 'alert alert-warn',
      `<b>Belum bisa dikirim:</b><ul>${item.missing.map((m) => `<li>${escapeHtml(m)}</li>`).join('')}</ul>`));
  }
  if (item.lengthWarning) {
    body.append(el('div', 'alert alert-warn', item.lengthWarning));
  }

  if (item.status === 'sent') body.append(sentInfo(item));
  else if (video) body.append(captionEditor(item, video));

  body.append(finalTextBox(item));

  if (item.status !== 'sent') body.append(waktuBaris(item));
}

/**
 * Item yang menunjuk channel yang sudah tidak ada di Buffer.
 * Calon penggantinya diambil dari endpoint yang sama dengan halaman Pengaturan,
 * supaya aturan pencocokannya cuma ada di satu tempat.
 */
function panelChannelMati(item) {
  const box = el('div', 'alert alert-bad');
  const isi = el('div');
  isi.append(html('div', null,
    '<b>Channel ini sudah tidak ada di Buffer.</b> Kemungkinan diputus lalu disambungkan ulang, ' +
    'sehingga ID-nya berubah. Item ini akan ditolak kalau tetap dikirim.'));

  const baris = el('div', 'row');
  baris.style.marginTop = '8px';
  baris.append(el('span', 'muted', 'Mencari channel pengganti…'));
  isi.append(baris);
  box.append(isi);

  api.getOrphanChannels().then(({ temuan }) => {
    const cocok = (temuan || []).find((t) => t.lama.id === item.channelId);
    baris.innerHTML = '';

    if (!cocok?.kandidat?.length) {
      baris.append(el('span', 'muted',
        'Belum ada channel pengganti yang cocok. Buka Pengaturan, tekan "Muat ulang channel" dulu.'));
      return;
    }

    const pilih = el('select');
    pilih.style.maxWidth = '240px';
    for (const k of cocok.kandidat) {
      pilih.append(Object.assign(el('option', null, k.label), { value: k.id }));
    }

    const alihkan = button('btn btn-ghost btn-sm', 'arrowRight', 'Alihkan ke channel ini');
    alihkan.onclick = async (e) => {
      const done = busy(e.currentTarget, 'Mengalihkan…');
      try {
        const hasil = await api.migrateChannel(item.channelId, pilih.value);
        toast(hasil.diubah + ' item dialihkan ke channel baru.', 'ok');
        await refresh();
      } catch (err) {
        toast('Gagal mengalihkan: ' + err.message, 'bad');
        done();
      }
    };

    baris.append(pilih, alihkan);
  }).catch(() => {
    baris.innerHTML = '';
    baris.append(el('span', 'muted', 'Daftar channel pengganti tidak bisa dibaca.'));
  });

  return box;
}

function sentInfo(item) {
  const box = el('div', 'row');
  box.append(el('span', 'muted',
    `Terkirim ke Buffer${item.sentAt ? ` pada ${new Date(item.sentAt).toLocaleString('id-ID')}` : ''}.`));
  if (item.sentMode === 'shareNow') box.append(el('span', 'badge badge-siap', 'dikirim langsung'));
  if (item.bufferPostId) {
    const a = el('a', 'linkbtn', 'Lihat di Buffer');
    a.href = 'https://publish.buffer.com/all-channels';
    a.target = '_blank';
    a.rel = 'noopener';
    box.append(a);
  }
  return box;
}

/**
 * Editor caption untuk platform baris ini — inilah "ikatan" yang tadinya hilang.
 */
function captionEditor(item, video) {
  const wrap = el('div', 'field');

  const label = el('div', 'row-between');
  label.append(el('label', 'lbl', `Caption ${item.platform}`));

  const alat = el('div', 'row');
  alat.style.gap = '4px';
  const tulis = button('btn btn-ghost btn-sm', 'sparkles', 'Tulis ulang');
  const lihat = button('btn btn-ghost btn-sm', 'eye', 'Preview');
  alat.append(tulis, lihat);
  label.append(alat);
  wrap.append(label);

  const ta = el('textarea');
  ta.rows = 4;
  ta.value = item.caption || '';
  ta.placeholder = `Caption untuk ${item.platform}…`;

  const counter = el('span', 'count');
  const syncCount = attachCounter(ta, counter, limitsFor(item.platform));

  const previewBox = el('div', 'preview-wrap');
  previewBox.hidden = true;
  const gambarPreview = () => {
    if (!previewBox.hidden) {
      previewBox.innerHTML = renderPreview(item.platform, { caption: ta.value, title: video.title || '' });
    }
  };
  lihat.onclick = () => {
    previewBox.hidden = !previewBox.hidden;
    lihat.innerHTML = '';
    lihat.append(icon(previewBox.hidden ? 'eye' : 'eyeOff', 14),
      el('span', null, previewBox.hidden ? 'Preview' : 'Tutup'));
    gambarPreview();
  };
  ta.addEventListener('input', gambarPreview);

  ta.onchange = async () => {
    syncCount();
    const captions = { ...video.captions, [item.platform]: ta.value };
    try {
      await api.updateVideo(video.id, { captions });
      video.captions = captions;
      toast('Caption tersimpan.', 'ok');
      await refresh();
    } catch (err) {
      toast(`Gagal menyimpan: ${err.message}`, 'bad');
    }
  };

  tulis.onclick = async (e) => {
    const done = busy(e.currentTarget, 'Menulis…');
    try {
      const { captions } = await api.planCaption(plan.id, video.id, video.brief || video.title, [item.platform]);
      video.captions = captions;
      toast('Caption ditulis ulang.', 'ok');
      await refresh();
    } catch (err) {
      toast(`AI gagal: ${err.message}`, 'bad');
      done();
    }
  };

  wrap.append(ta, counter, previewBox);

  // Caption itu milik VIDEO + PLATFORM, bukan milik baris ini sendiri.
  const kembar = plan.items.filter(
    (i) => i.videoId === item.videoId && i.platform === item.platform && i.index !== item.index
  );
  if (kembar.length) {
    wrap.append(html('p', 'note', `Caption ini dipakai juga oleh <b>${
      kembar.map((k) => escapeHtml(k.channelLabel)).join(', ')
    }</b> — mengubahnya di sini ikut mengubah baris tersebut.`));
  }

  return wrap;
}

/** Teks final persis seperti yang akan dikirim ke Buffer. */
function finalTextBox(item) {
  const box = el('div', 'finalbox');
  box.append(el('div', 'finalbox-head', 'Teks final yang dikirim ke Buffer'));

  const pre = el('pre', 'finaltext');
  pre.textContent = 'Memuat…';
  box.append(pre);

  api.planItemText(plan.id, item.index)
    .then(({ text, length, metadata }) => {
      pre.textContent = text || '(masih kosong)';
      const catatan = [`${length} karakter`];
      if (metadata) catatan.push(`metadata: ${Object.keys(metadata).join(', ')}`);
      box.append(el('div', 'finalbox-foot tnum', catatan.join(' · ')));
    })
    .catch((err) => { pre.textContent = `Gagal memuat teks: ${err.message}`; });

  return box;
}

/** Tanggal & jam tayang, bisa diubah langsung — jalan keluar untuk item kedaluwarsa. */
function waktuBaris(item) {
  const row = el('div', 'row-between');
  row.style.marginTop = 'var(--s4)';

  const kiri = el('div', 'row');
  kiri.append(el('span', 'muted', 'Tayang'));

  const tanggal = el('input');
  tanggal.type = 'date';
  tanggal.value = item.date;
  tanggal.style.width = '160px';

  const jam = el('input');
  jam.type = 'time';
  jam.value = item.time;
  jam.style.width = '112px';

  const simpan = async () => {
    try {
      await api.updatePlanItem(plan.id, item.index, { date: tanggal.value, time: jam.value });
      toast('Waktu diperbarui.', 'ok');
      await refresh();
    } catch (err) {
      toast(err.message, 'bad');
      tanggal.value = item.date;
      jam.value = item.time;
    }
  };
  tanggal.onchange = simpan;
  jam.onchange = simpan;

  kiri.append(tanggal, jam);
  row.append(kiri);

  const aksi = el('div', 'row');
  aksi.style.gap = '6px';

  // Tayang langsung, tidak menunggu jadwal di sebelah kiri.
  const sekarang = button('btn btn-ghost btn-sm', 'bolt', 'Kirim sekarang');
  sekarang.title = 'Tayangkan langsung, abaikan jadwal item ini';
  sekarang.onclick = (e) => {
    if (!confirm(`Tayangkan "${item.videoTitle}" di ${item.channelLabel} SEKARANG?\n\n` +
      'Jadwal item ini diabaikan dan post langsung dikirim ke platformnya.')) return;
    sendItems(e.currentTarget, [item], true);
  };

  const kirim = button('btn btn-primary btn-sm', 'send', 'Kirim sesuai jadwal');
  kirim.onclick = (e) => sendItems(e.currentTarget, [item]);

  aksi.append(sekarang, kirim);
  row.append(aksi);

  return row;
}

// ================= aksi =================

/** Video yang masih punya platform tanpa caption di jadwal ini. */
function videoPerluCaption() {
  const perlu = new Map();
  for (const item of plan.items) {
    if (item.status === 'sent' || item.caption?.trim()) continue;
    if (!perlu.has(item.videoId)) perlu.set(item.videoId, new Set());
    perlu.get(item.videoId).add(item.platform);
  }
  return [...perlu.entries()].map(([videoId, platforms]) => ({ videoId, platforms: [...platforms] }));
}

async function generateCaptions(trigger, target) {
  const done = busy(trigger, `Menulis 0/${target.length}`);
  let ok = 0;

  for (const [i, { videoId, platforms }] of target.entries()) {
    trigger.innerHTML = `<span class="spin"></span> Menulis ${i + 1}/${target.length}`;
    const video = videosById.get(videoId);
    try {
      await api.planCaption(plan.id, videoId, video?.brief || video?.title, platforms);
      ok++;
    } catch (err) {
      toast(`${video?.title || videoId}: ${err.message}`, 'bad');
    }
  }

  done();
  toast(`Caption selesai untuk ${ok} dari ${target.length} video.`, ok === target.length ? 'ok' : 'bad');
  await refresh();
}

async function sendItems(trigger, items, sekarang = false) {
  const pending = items.filter((i) => i.status !== 'sent');
  if (!pending.length) return toast('Tidak ada yang perlu dikirim.', 'ok');

  const belum = pending.filter((i) => !i.ready);
  if (belum.length && !confirm(
    `${belum.length} dari ${pending.length} post bahannya belum lengkap dan hampir pasti ditolak Buffer.\n\n` +
    'Tetap coba kirim semuanya?'
  )) return;

  if (pending.length > 1 && !confirm(
    `Kirim ${pending.length} post ke Buffer sekarang?\n\nIni memakai ${pending.length} request dari kuota harian Buffer.`
  )) return;

  const done = busy(trigger, `Mengirim 0/${pending.length}`);
  let ok = 0;

  for (const [i, item] of pending.entries()) {
    trigger.innerHTML = `<span class="spin"></span> Mengirim ${i + 1}/${pending.length}`;
    try {
      const { item: updated, catatan } = await api.sendPlanItem(plan.id, item.index, sekarang);
      Object.assign(plan.items[item.index], updated);
      if (updated.status === 'sent') ok++;
      // Buffer bisa menolak mode "kirim sekarang" dan post dimundurkan —
      // itu harus dibilang, bukan didiamkan.
      if (catatan) toast(catatan, 'bad');
    } catch (err) {
      Object.assign(plan.items[item.index], { status: 'error', state: 'error', error: err.message });
      // Kalau kuota API habis, tidak ada gunanya melanjutkan.
      if (/kuota|rate/i.test(err.message)) {
        toast(err.message, 'bad');
        break;
      }
    }

    gantiBaris(item.index);
    document.dispatchEvent(new Event('buffer-usage-changed'));

    // Jeda kecil supaya tidak menabrak batas 100 request / 15 menit.
    if (i < pending.length - 1) await sleep(400);
  }

  done();
  toast(`${ok} dari ${pending.length} post terkirim.`, ok === pending.length ? 'ok' : 'bad');
  await refresh();
}

function gantiBaris(index) {
  const lama = view.querySelector(`.item[data-index="${index}"]`);
  if (lama) lama.replaceWith(itemRow(plan.items[index]));
}

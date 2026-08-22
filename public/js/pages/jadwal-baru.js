/**
 * Menyusun jadwal rotasi baru.
 *
 * Dulu form ini menempel di bawah daftar jadwal tersimpan pada halaman yang
 * sama. Sekarang berdiri sendiri di /jadwal/baru: satu halaman = satu pekerjaan.
 *
 * Dua hal yang diperbaiki dari versi sebelumnya:
 *  - tanggal mulai bawaannya BESOK, bukan hari ini. Jam tayang bawaan mulai
 *    09:00, jadi kalau jadwal dibuat siang/sore, slot hari ini sudah lewat dan
 *    Buffer menolaknya. Itu penyebab paling sering munculnya "sudah lewat".
 *  - tabel pratinjau menandai sel yang bahannya belum lengkap, jadi
 *    kekurangannya ketahuan di sini, bukan setelah 18 post ditolak sekaligus.
 */
import * as api from '../api.js';
import {
  el, html, toast, busy, escapeHtml, formatDayLabel, formatRange,
  tomorrowISO, platformDot, button, setPageTitle
} from '../utils.js';
import { QUEUE_LIMIT, metaFor } from '../config.js';
import { namaAktif, idAktif } from '../grup.js';

let videos = [];
let channels = [];
let tanpaGrup = [];
let hashtagSets = [];
let queue = { counts: {}, limit: QUEUE_LIMIT };
let view = null;

export async function render(container) {
  view = container;
  setPageTitle('Jadwal baru');

  view.append(el('p', 'empty', 'Memuat data…'));

  const [videoRes, channelRes, hashtagRes] = await Promise.allSettled([
    api.listVideos(),
    api.getChannelsDetail(),
    api.listHashtags()
  ]);

  videos = videoRes.status === 'fulfilled' ? videoRes.value.videos : [];
  const channelData = channelRes.status === 'fulfilled' ? channelRes.value : { channels: [] };
  channels = channelData.channels || [];
  tanpaGrup = channelData.tanpaGrup || [];
  hashtagSets = hashtagRes.status === 'fulfilled' ? hashtagRes.value.sets : [];

  try {
    queue = await api.getQueue();
  } catch {
    queue = { counts: {}, limit: QUEUE_LIMIT };
  }

  view.innerHTML = '';
  renderBuilder(channelData);
}

function renderBuilder(channelData) {
  const wrap = el('div', 'stack');

  const head = html('div', 'page-head', `
    <div>
      <a class="backlink" href="#/jadwal">Jadwal</a>
      <h2 class="page-title">Jadwal baru</h2>
      <p class="page-sub">
        Grup <b>${escapeHtml(namaAktif())}</b> — hanya video dan channel grup ini yang ikut.
        Tiap video digilir ke semua channel di hari yang berbeda-beda.
      </p>
    </div>
  `);
  wrap.append(head);

  if (!channels.length) {
    // Bedakan "token bermasalah" dari "grup ini memang belum punya channel" —
    // dua keadaan itu butuh tindakan yang sama sekali berbeda.
    const adaDiGrupLain = (channelData.grupLain || 0) > 0 || tanpaGrup.length > 0;
    wrap.append(html('div', 'alert alert-bad', `
      <b>Grup ${escapeHtml(namaAktif())} belum punya channel.</b>
      <div style="margin-top:5px">${escapeHtml(
        channelData.problem ||
        (adaDiGrupLain
          ? 'Channelnya ada, tapi belum ditetapkan ke grup ini. Buka Pengaturan untuk menetapkannya.'
          : 'Isi BUFFER_TOKEN_A / BUFFER_TOKEN_B di .env, lalu muat ulang.')
      )}</div>
    `));
    if (tanpaGrup.length) wrap.append(panelTanpaGrup());
    view.append(wrap);
    return;
  }

  wrap.append(videoPanel(videos));
  wrap.append(channelPanel());
  wrap.append(optionPanel());
  wrap.append(previewPanel());

  view.append(wrap);
  view.append(stickyBar());

  for (const id of ['startDate', 'daysBetween', 'offsetStep']) {
    view.querySelector(`#${id}`).onchange = schedulePreview;
  }
  view.querySelector('#refreshPreview').onclick = () => doPreview();
  view.querySelector('#createBtn').onclick = onCreate;

  nomoriUlang();
  doPreview();
}

// ---------- langkah 1: video ----------

function videoPanel(daftar) {
  const panel = html('section', 'panel', `
    <div class="step">
      <span class="step-num">1</span>
      <div>
        <div class="panel-title">Video yang ikut</div>
        <p class="hint">
          Hanya video grup ini. Urutannya mengikuti halaman Stok. Video yang pernah dipakai tetap
          bisa dipilih lagi — berguna kalau satu platform gagal dan perlu dijadwalkan ulang sendirian.
        </p>
      </div>
    </div>
    <div class="vlist" id="videoPick"></div>
  `);
  const pick = panel.querySelector('#videoPick');

  if (!daftar.length) {
    pick.append(html('p', 'empty',
      'Belum ada video. Tambahkan dulu di <a href="#/stok">Stok Video</a>.'));
    return panel;
  }

  for (const video of daftar) {
    const row = el('label', 'vrow');
    row.style.gridTemplateColumns = 'auto auto 1fr';

    const cb = el('input');
    cb.type = 'checkbox';
    // Yang belum pernah dipakai dicentang otomatis; yang sudah pernah dibiarkan
    // mati supaya tidak ikut terkirim ulang tanpa disengaja.
    cb.checked = video.status === 'stock';
    cb.dataset.videoId = video.id;
    cb.className = 'video-check';
    cb.onchange = () => { nomoriUlang(); schedulePreview(); };

    const body = el('div', 'vbody');
    body.append(el('div', 'vtitle truncate', video.title || video.filename));

    const meta = el('div', 'vmeta');
    if (!video.title) meta.append(el('span', 'warn-text', 'belum ada judul'));
    if (!video.brief) meta.append(el('span', null, 'belum ada brief'));

    const jejak = jejakPlatform(video);
    if (jejak) meta.append(jejak);
    if (meta.childElementCount) body.append(meta);

    row.append(cb, el('span', 'vnum', ''), body);
    pick.append(row);
  }

  return panel;
}

/** Penanda kecil: video ini sudah sampai ke platform mana saja. */
function jejakPlatform(video) {
  const bagian = [
    ['terkirim', video.terkirim, 'sudah terkirim ke'],
    ['gagal', video.gagal, 'gagal di'],
    ['antre', video.terjadwal, 'masih mengantre di']
  ].filter(([, daftar]) => daftar?.length);

  if (!bagian.length) return null;

  const bungkus = el('span', 'jejak');
  for (const [jenis, daftar, keterangan] of bagian) {
    for (const platform of daftar) {
      const dot = platformDot(platform);
      dot.classList.add('pdot-xs', `pdot-${jenis}`);
      dot.title = `${keterangan} ${metaFor(platform).name}`;
      bungkus.append(dot);
    }
  }
  return bungkus;
}

/**
 * Nomor rotasi hanya berlaku untuk video yang dicentang, jadi dihitung ulang
 * tiap kali pilihannya berubah — kalau tidak, V1..Vn menunjuk urutan yang
 * tidak dipakai algoritmanya.
 */
function nomoriUlang() {
  let n = 0;
  for (const row of view.querySelectorAll('#videoPick .vrow')) {
    const cb = row.querySelector('.video-check');
    const num = row.querySelector('.vnum');
    if (!cb || !num) continue;
    num.textContent = cb.checked ? `V${++n}` : '–';
    num.classList.toggle('vnum-off', !cb.checked);
  }
}

// ---------- langkah 2: channel ----------

function channelPanel() {
  const panel = html('section', 'panel', `
    <div class="step">
      <span class="step-num">2</span>
      <div class="grow">
        <div class="row-between">
          <div class="panel-title" style="margin:0">Channel tujuan</div>
          <button class="btn btn-ghost btn-sm" id="muatChannel">Muat ulang channel</button>
        </div>
        <p class="hint" style="margin-top:6px">Angka abu-abu = post yang sekarang mengantre di Buffer (batas ${QUEUE_LIMIT}/channel).</p>
      </div>
    </div>
    <div class="vlist" id="channelPick"></div>
  `);
  const pick = panel.querySelector('#channelPick');

  // Daftar channel di-cache 1 jam dan ikut tersimpan di volume permanen, jadi
  // channel yang baru disambungkan ulang di Buffer tidak muncul sampai
  // cachenya kedaluwarsa — deploy ulang pun tidak menolong.
  panel.querySelector('#muatChannel').onclick = async (e) => {
    const done = busy(e.currentTarget, 'Mengambil…');
    try {
      const segar = await api.getChannelsDetail(true);
      channels = segar.channels || [];
      tanpaGrup = segar.tanpaGrup || [];
      view.innerHTML = '';
      renderBuilder(segar);
      toast('Daftar channel diambil ulang dari Buffer.', 'ok');
    } catch (err) {
      toast('Gagal: ' + err.message, 'bad');
      done();
    }
  };

  for (const channel of channels) {
    const used = queue.counts?.[channel.id] || 0;
    const row = el('label', 'vrow');
    row.style.gridTemplateColumns = 'auto auto 1fr auto';

    const cb = el('input');
    cb.type = 'checkbox';
    cb.checked = true;
    cb.dataset.channelId = channel.id;
    cb.className = 'channel-check';
    cb.onchange = schedulePreview;

    const body = el('div', 'vbody');
    body.append(el('div', 'vtitle truncate', channel.label));
    body.append(el('div', 'vmeta', `${channel.platform} · akun ${channel.account}`));

    const time = el('input');
    time.type = 'time';
    time.className = 'channel-hour';
    time.dataset.channelId = channel.id;
    time.style.width = '104px';
    time.onchange = schedulePreview;
    time.title = 'Jam tayang channel ini';

    const right = el('div', 'row');
    right.style.flexWrap = 'nowrap';
    right.append(
      el('span', `badge${used >= QUEUE_LIMIT ? ' badge-error' : ''}`, `${used}/${QUEUE_LIMIT}`),
      time
    );

    row.append(cb, platformDot(channel.platform), body, right);
    pick.append(row);

    // Pinterest wajib punya board tujuan — tanpa itu Buffer menolak pin-nya.
    if (channel.platform === 'pinterest') pick.append(buildBoardPicker(channel));
  }

  if (tanpaGrup.length) panel.append(panelTanpaGrup());

  return panel;
}

/**
 * Channel yang belum ditetapkan grupnya.
 *
 * Channel seperti ini tidak masuk grup mana pun — itu disengaja, supaya channel
 * brand baru tidak diam-diam ikut terkirimi konten brand lama. Tapi kalau tidak
 * ditampilkan di sini, dia tidak muncul di layar mana pun dan orangnya tidak
 * pernah tahu harus menetapkannya. Sengaja TIDAK tercentang.
 */
function panelTanpaGrup() {
  const box = el('div', 'alert alert-warn');
  box.style.marginTop = 'var(--s3)';

  const isi = el('div', 'grow');
  isi.append(el('div', null,
    `${tanpaGrup.length} channel belum punya grup, jadi belum bisa dipakai menjadwalkan apa pun:`));

  const daftar = el('div', 'vlist');
  daftar.style.marginTop = '8px';

  for (const channel of tanpaGrup) {
    const baris = el('div', 'vrow');
    baris.style.gridTemplateColumns = 'auto 1fr auto';

    const badan = el('div', 'vbody');
    badan.append(el('div', 'vtitle truncate', channel.label));
    badan.append(el('div', 'vmeta', `${channel.platform} · akun ${channel.account}`));

    const tombol = button('btn btn-ghost btn-sm', 'check', `Masukkan ke ${namaAktif()}`);
    tombol.onclick = async (e) => {
      const done = busy(e.currentTarget, 'Menetapkan…');
      try {
        await api.assignChannels(idAktif(), [channel.id]);
        toast(`${channel.label} masuk grup ${namaAktif()}.`, 'ok');
        const segar = await api.getChannelsDetail(true);
        channels = segar.channels || [];
        tanpaGrup = segar.tanpaGrup || [];
        view.innerHTML = '';
        renderBuilder(segar);
      } catch (err) {
        toast('Gagal: ' + err.message, 'bad');
        done();
      }
    };

    baris.append(platformDot(channel.platform), badan, tombol);
    daftar.append(baris);
  }

  isi.append(daftar);
  box.append(isi);
  return box;
}

/**
 * Pemilih board Pinterest — versi ringkas.
 *
 * Board tersimpan permanen per channel di server, jadi sebenarnya ini
 * SETELAN, bukan bagian dari jadwal. Selama halaman Pengaturan belum ada,
 * tempatnya tetap di sini, tapi diringkas jadi satu baris supaya tidak
 * ikut memakan perhatian setiap kali menyusun jadwal.
 */
function buildBoardPicker(channel) {
  const box = el('div', 'boardrow');

  const value = el('span', 'boardrow-value', 'Memuat board…');
  const edit = el('button', 'linkbtn');
  edit.type = 'button';
  edit.textContent = 'ubah';
  edit.hidden = true;

  const head = el('div', 'boardrow-head');
  head.append(el('span', 'boardrow-label', 'Board Pinterest'), value, edit);

  const select = el('select');
  const reload = button('btn btn-ghost btn-sm', 'refresh', 'Muat ulang');
  const note = el('p', 'muted');
  const editor = el('div', 'boardrow-edit');
  editor.hidden = true;
  editor.append(select, reload, note);

  box.append(head, editor);

  const tampilkanEditor = (tampil) => {
    editor.hidden = !tampil;
    edit.textContent = tampil ? 'tutup' : 'ubah';
  };
  edit.onclick = () => tampilkanEditor(editor.hidden);

  const load = async (force) => {
    const done = force ? busy(reload, 'Memuat…') : null;
    select.disabled = true;
    select.innerHTML = '';
    select.append(el('option', null, 'Memuat board…'));

    try {
      const { boards, selected, problem, channelAda } = await api.getChannelBoards(channel.id, force);
      select.innerHTML = '';
      note.innerHTML = '';

      if (problem || !boards.length) {
        select.append(el('option', null, 'Board tidak bisa dibaca'));
        value.className = 'boardrow-value bad';
        edit.hidden = false;
        tampilkanEditor(true);

        if (problem) {
          value.textContent = `gagal dibaca: ${problem}`;
        } else if (channelAda === false) {
          // Menyarankan "sambungkan ulang" di sini justru salah — itu sebabnya.
          value.textContent = 'channel ini sudah tidak ada di Buffer';
          note.innerHTML =
            'Biasanya karena diputus lalu disambungkan ulang, sehingga Buffer memberi ID baru. ' +
            'Tekan <b>Muat ulang channel</b> di atas, lalu pindahkan setelannya lewat halaman ' +
            '<a href="#/pengaturan">Pengaturan</a>.';
        } else {
          value.textContent = 'belum ada board terbaca';
          note.innerHTML = 'Kalau board-nya baru dibuat, tekan <b>Muat ulang</b> — Buffer kadang ' +
            'butuh beberapa menit menyinkronkannya.';
        }
        return;
      }

      select.append(Object.assign(el('option', null, '— pilih board —'), { value: '' }));
      for (const board of boards) {
        select.append(Object.assign(el('option', null, board.name), { value: board.id }));
      }
      select.value = selected || '';
      select.disabled = false;
      edit.hidden = false;

      const sync = () => {
        const nama = boards.find((b) => b.id === select.value)?.name;
        value.className = `boardrow-value${nama ? '' : ' bad'}`;
        value.textContent = nama || 'belum dipilih — pin akan ditolak';
        tampilkanEditor(!nama);
      };
      sync();

      select.onchange = async () => {
        try {
          await api.setChannelSettings(channel.id, { boardId: select.value });
          sync();
          schedulePreview();
        } catch (err) {
          value.className = 'boardrow-value bad';
          value.textContent = `gagal menyimpan: ${err.message}`;
        }
      };
    } catch (err) {
      value.className = 'boardrow-value bad';
      value.textContent = err.message;
      edit.hidden = false;
    } finally {
      if (done) done();
    }
  };

  reload.onclick = () => load(true);
  load(false);

  return box;
}

// ---------- langkah 3: setelan ----------

function optionPanel() {
  const panel = html('section', 'panel', `
    <div class="step">
      <span class="step-num">3</span>
      <div>
        <div class="panel-title">Setelan rotasi</div>
        <p class="hint">Bawaannya mulai besok — slot pagi hari ini biasanya sudah lewat dan ditolak Buffer.</p>
      </div>
    </div>
    <div class="field-row cols-3">
      <div class="field">
        <label class="lbl" for="startDate">Mulai tanggal</label>
        <input type="date" id="startDate" value="${tomorrowISO()}" />
      </div>
      <div class="field">
        <label class="lbl" for="daysBetween">Jarak antar putaran (hari)</label>
        <input type="number" id="daysBetween" min="1" max="30" value="1" />
      </div>
      <div class="field">
        <label class="lbl" for="offsetStep">Geser video antar channel</label>
        <input type="number" id="offsetStep" min="1" max="10" value="1" />
      </div>
    </div>
    <div class="field">
      <label class="lbl">Set hashtag yang dipakai</label>
      <div class="chips" id="hashtagPick"></div>
    </div>
  `);

  const pick = panel.querySelector('#hashtagPick');
  if (!hashtagSets.length) {
    pick.append(html('span', 'muted', 'Belum ada set. Bikin di halaman <a href="#/hashtag">Hashtag</a>.'));
  }
  for (const set of hashtagSets) {
    const chip = el('label', `chip${set.isDefault ? ' on' : ''}`);
    const cb = el('input');
    cb.type = 'checkbox';
    cb.checked = !!set.isDefault;
    cb.dataset.setId = set.id;
    cb.className = 'hashtag-check';
    cb.onchange = () => {
      chip.classList.toggle('on', cb.checked);
      schedulePreview();
    };
    chip.append(cb, el('span', null, `${set.name} (${set.tags.length})`));
    pick.append(chip);
  }

  return panel;
}

// ---------- langkah 4: pratinjau ----------

function previewPanel() {
  return html('section', 'panel', `
    <div class="step">
      <span class="step-num">4</span>
      <div class="grow">
        <div class="row-between">
          <div class="panel-title" style="margin:0">Pratinjau rotasi</div>
          <button class="btn btn-ghost btn-sm" id="refreshPreview">Hitung ulang</button>
        </div>
        <p class="hint" style="margin-top:6px">
          Baris = channel, kolom = hari. Sel bergaris merah berarti bahannya belum lengkap —
          masih bisa dilengkapi setelah jadwal disimpan.
        </p>
      </div>
    </div>
    <div id="previewWarn"></div>
    <div id="previewBody"><p class="muted">Menghitung…</p></div>
  `);
}

function stickyBar() {
  const bar = html('div', 'stickybar', `
    <div class="stickybar-inner">
      <div class="stickybar-info" id="sumInfo">
        <strong>—</strong>
        <span class="muted">pilih video dan channel dulu</span>
      </div>
      <button class="btn btn-primary" id="createBtn" disabled>Simpan jadwal</button>
    </div>
  `);
  return bar;
}

// ---------- pratinjau ----------

function collectOptions() {
  const pick = (sel, attr) =>
    [...view.querySelectorAll(sel)].filter((c) => c.checked).map((c) => c.dataset[attr]);

  const channelHours = {};
  for (const input of view.querySelectorAll('.channel-hour')) {
    if (input.value) channelHours[input.dataset.channelId] = input.value;
  }

  return {
    videoIds: pick('.video-check', 'videoId'),
    channelIds: pick('.channel-check', 'channelId'),
    hashtagSetIds: pick('.hashtag-check', 'setId'),
    startDate: view.querySelector('#startDate')?.value || tomorrowISO(),
    daysBetween: Number(view.querySelector('#daysBetween')?.value) || 1,
    offsetStep: Number(view.querySelector('#offsetStep')?.value) || 1,
    channelHours
  };
}

let previewTimer = null;
function schedulePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(doPreview, 250);
}

async function doPreview() {
  const body = view.querySelector('#previewBody');
  const warnBox = view.querySelector('#previewWarn');
  if (!body) return;

  const options = collectOptions();
  if (!options.videoIds.length || !options.channelIds.length) {
    warnBox.innerHTML = '';
    body.innerHTML = '<p class="muted">Pilih minimal satu video dan satu channel.</p>';
    setSummary(null);
    return;
  }

  try {
    const result = await api.previewPlan(options);

    warnBox.innerHTML = '';
    if (result.warnings?.length) {
      warnBox.append(html('div', 'alert alert-warn',
        `<b>Perhatikan:</b><ul>${result.warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join('')}</ul>`));
    }

    body.innerHTML = '';
    body.append(buildMatrixTable(result.matrix));
    setSummary(result, options);
  } catch (err) {
    body.innerHTML = '';
    body.append(el('div', 'alert alert-bad', `Gagal menghitung pratinjau: ${err.message}`));
    setSummary(null);
  }
}

function setSummary(result, options) {
  const info = view.querySelector('#sumInfo');
  const btn = view.querySelector('#createBtn');
  if (!info || !btn) return;

  if (!result) {
    info.innerHTML = '<strong>—</strong><span class="muted">pilih video dan channel dulu</span>';
    btn.disabled = true;
    return;
  }

  const akhir = result.matrix[0]?.cells.at(-1)?.date;
  const rentang = formatRange(options.startDate, akhir);
  const kurang = result.belumLengkap
    ? `<span class="warn-text">${result.belumLengkap} sel belum lengkap</span>`
    : '<span class="muted">semua bahan lengkap</span>';

  info.innerHTML =
    `<strong>${result.items.length} post</strong>` +
    `<span class="muted">${result.videoCount} video × ${result.channelCount} channel · ${escapeHtml(rentang)}</span>` +
    kurang;
  btn.disabled = false;
}

/** Tabel: baris = channel, kolom = tanggal. Inilah bentuk rotasinya. */
function buildMatrixTable(matrix) {
  const scroll = el('div', 'table-scroll');
  const table = el('table', 'grid');

  const thead = el('thead');
  const headRow = el('tr');
  headRow.append(el('th', null, 'Channel'));
  for (const cell of matrix[0]?.cells || []) headRow.append(el('th', null, formatDayLabel(cell.date)));
  thead.append(headRow);
  table.append(thead);

  const tbody = el('tbody');
  for (const row of matrix) {
    const tr = el('tr');

    const th = el('th');
    th.style.display = 'flex';
    th.style.alignItems = 'center';
    th.style.gap = '6px';
    th.append(platformDot(row.platform), el('span', 'truncate', row.label));
    tr.append(th);

    for (const cell of row.cells) {
      const td = el('td', `cell${cell.missing?.length ? ' cell-bad' : ''}${cell.isPast ? ' cell-past' : ''}`);
      td.append(el('span', null, cell.videoTitle || cell.videoId));
      td.append(el('span', 'cell-time', cell.time));
      if (cell.missing?.length) {
        td.title = `Belum lengkap: ${cell.missing.join(', ')}`;
      } else if (cell.isPast) {
        td.title = 'Waktunya sudah lewat — Buffer akan menolaknya';
      }
      tr.append(td);
    }
    tbody.append(tr);
  }
  table.append(tbody);
  scroll.append(table);
  return scroll;
}

// ---------- simpan ----------

async function onCreate(e) {
  const options = collectOptions();
  if (!options.videoIds.length) return toast('Pilih minimal satu video.', 'bad');
  if (!options.channelIds.length) return toast('Pilih minimal satu channel.', 'bad');

  const done = busy(e.currentTarget, 'Menyimpan…');
  try {
    const { plan, warnings } = await api.createPlan(options);
    if (warnings?.length) toast(warnings[0], 'bad');
    toast('Jadwal tersimpan. Lanjut lengkapi captionnya.', 'ok');
    location.hash = `/jadwal?id=${plan.id}`;
  } catch (err) {
    toast(`Gagal menyimpan jadwal: ${err.message}`, 'bad');
    done();
  }
}

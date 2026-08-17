/**
 * Jadwal rotasi.
 *
 * Alurnya: atur → pratinjau tabel → simpan → generate caption → kirim per item.
 * Pengiriman dilakukan satu item per request supaya progresnya kelihatan dan
 * item yang gagal bisa diulang sendiri-sendiri.
 */
import * as api from '../api.js';
import {
  el, html, toast, busy, escapeHtml, formatDayLabel, todayISO, sleep,
  platformDot, attachCounter, icon, iconSvg, button, iconButton
} from '../utils.js';
import { QUEUE_LIMIT, limitsFor } from '../config.js';
import { renderPreview } from '../preview.js';

let videos = [];
let channels = [];
let hashtagSets = [];
let queue = { counts: {}, limit: QUEUE_LIMIT };
let view = null;

export async function render(container, params) {
  view = container;

  // Kalau dibuka dengan ?id=... langsung tampilkan jadwal yang sudah ada.
  const planId = params?.get('id');
  if (planId) return renderPlan(planId);

  const wrap = el('div', 'stack');
  wrap.append(el('p', 'empty', 'Memuat data…'));
  view.append(wrap);

  const [videoRes, channelRes, hashtagRes] = await Promise.allSettled([
    api.listVideos(),
    api.getChannelsDetail(),
    api.listHashtags()
  ]);

  videos = videoRes.status === 'fulfilled' ? videoRes.value.videos : [];
  const channelData = channelRes.status === 'fulfilled' ? channelRes.value : { channels: [] };
  channels = channelData.channels || [];
  hashtagSets = hashtagRes.status === 'fulfilled' ? hashtagRes.value.sets : [];

  try {
    queue = await api.getQueue();
  } catch {
    queue = { counts: {}, limit: QUEUE_LIMIT };
  }

  view.innerHTML = '';
  renderBuilder(channelData);
}

// ================= penyusun jadwal =================

function renderBuilder(channelData) {
  const wrap = el('div', 'stack');

  if (!channels.length) {
    wrap.append(html('div', 'alert alert-bad', `
      <b>Belum ada channel.</b>
      <div style="margin-top:5px">${escapeHtml(
        channelData.problem || 'Isi BUFFER_TOKEN_A / BUFFER_TOKEN_B di .env, lalu muat ulang.'
      )}</div>
    `));
    view.append(wrap);
    return;
  }

  const stock = videos.filter((v) => v.status === 'stock');

  // ---------- daftar jadwal lama ----------
  const plansPanel = html('section', 'panel', `
    <div class="panel-title">Jadwal tersimpan</div>
    <div id="planList"><p class="muted">Memuat…</p></div>
  `);
  wrap.append(plansPanel);
  loadPlanList(plansPanel.querySelector('#planList'));

  // ---------- pilih video ----------
  const videoPanel = html('section', 'panel', `
    <div class="panel-title">1 · Video yang ikut</div>
    <p class="hint">Urutannya mengikuti halaman Stok. Video paling atas = V1.</p>
    <div class="vlist" id="videoPick"></div>
  `);
  const videoPick = videoPanel.querySelector('#videoPick');

  if (!stock.length) {
    videoPick.append(html('p', 'empty', 'Tidak ada video berstatus stok. Tambahkan dulu di halaman <a href="#/stok">Stok Video</a>.'));
  } else {
    stock.forEach((video, i) => {
      const row = el('label', 'vrow');
      row.style.gridTemplateColumns = 'auto auto 1fr';
      const cb = el('input');
      cb.type = 'checkbox';
      cb.checked = true;
      cb.dataset.videoId = video.id;
      cb.className = 'video-check';
      cb.onchange = schedulePreview;

      const body = el('div', 'vbody');
      body.append(el('div', 'vtitle truncate', video.title || video.filename));
      const meta = el('div', 'vmeta');
      meta.append(el('span', null, `V${i + 1}`));
      if (!video.title) meta.append(el('span', null, 'belum ada judul'));
      if (!video.brief) meta.append(el('span', null, 'belum ada brief'));
      body.append(meta);

      row.append(cb, el('span', 'vnum', `V${i + 1}`), body);
      videoPick.append(row);
    });
  }
  wrap.append(videoPanel);

  // ---------- pilih channel ----------
  const channelPanel = html('section', 'panel', `
    <div class="panel-title">2 · Channel tujuan</div>
    <p class="hint">Angka di kanan = post yang sekarang mengantre di Buffer (batas ${QUEUE_LIMIT}/channel).</p>
    <div class="vlist" id="channelPick"></div>
  `);
  const channelPick = channelPanel.querySelector('#channelPick');

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
    time.style.width = '110px';
    time.onchange = schedulePreview;

    const quota = el('span', 'badge' + (used >= QUEUE_LIMIT ? ' badge-error' : ''), `${used}/${QUEUE_LIMIT}`);

    const right = el('div', 'row');
    right.append(quota, time);

    row.append(cb, platformDot(channel.platform), body, right);
    channelPick.append(row);

    // Pinterest wajib punya board tujuan — tanpa itu Buffer menolak pin-nya.
    if (channel.platform === 'pinterest') channelPick.append(buildBoardPicker(channel));
  }
  wrap.append(channelPanel);

  // ---------- setelan ----------
  const optionPanel = html('section', 'panel', `
    <div class="panel-title">3 · Setelan rotasi</div>
    <div class="field-row cols-3">
      <div class="field">
        <label class="lbl" for="startDate">Mulai tanggal</label>
        <input type="date" id="startDate" value="${todayISO()}" />
      </div>
      <div class="field">
        <label class="lbl" for="daysBetween">Jarak antar putaran</label>
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

  const hashtagPick = optionPanel.querySelector('#hashtagPick');
  if (!hashtagSets.length) {
    hashtagPick.append(html('span', 'muted', 'Belum ada set. Bikin di halaman <a href="#/hashtag">Hashtag</a>.'));
  }
  for (const set of hashtagSets) {
    const chip = el('label', `chip${set.isDefault ? ' on' : ''}`);
    const cb = el('input');
    cb.type = 'checkbox';
    cb.checked = !!set.isDefault;
    cb.dataset.setId = set.id;
    cb.className = 'hashtag-check';
    cb.onchange = () => chip.classList.toggle('on', cb.checked);
    chip.append(cb, el('span', null, `${set.name} (${set.tags.length})`));
    hashtagPick.append(chip);
  }
  wrap.append(optionPanel);

  // ---------- pratinjau ----------
  const previewPanel = html('section', 'panel', `
    <div class="row-between" style="margin-bottom:10px">
      <div class="panel-title" style="margin:0">4 · Pratinjau rotasi</div>
      <button class="btn btn-ghost btn-sm" id="refreshPreview">Hitung ulang</button>
    </div>
    <div id="previewWarn"></div>
    <div id="previewBody"><p class="muted">Menghitung…</p></div>
    <div style="margin-top:14px">
      <button class="btn btn-primary btn-block" id="createBtn">Simpan jadwal ini</button>
    </div>
  `);
  wrap.append(previewPanel);

  view.append(wrap);

  previewPanel.querySelector('#refreshPreview').onclick = () => doPreview();
  previewPanel.querySelector('#createBtn').onclick = onCreate;
  for (const id of ['startDate', 'daysBetween', 'offsetStep']) {
    optionPanel.querySelector(`#${id}`).onchange = schedulePreview;
  }

  doPreview();
}

/**
 * Pemilih board Pinterest.
 * `boardServiceId` wajib ada di metadata pin; kalau kosong, Buffer menolak
 * dengan "Invalid post". Daftarnya diambil dari Buffer dan pilihannya
 * disimpan per channel di server, jadi cukup dipilih sekali.
 */
function buildBoardPicker(channel) {
  const box = el('div', 'subcard');
  box.style.marginLeft = '34px';

  const label = el('label', 'lbl', `Board tujuan untuk ${channel.label}`);
  const select = el('select');
  select.disabled = true;
  select.append(el('option', null, 'Memuat board…'));

  const note = el('p', 'muted');
  note.style.marginTop = '6px';

  box.append(label, select, note);

  (async () => {
    try {
      const { boards, selected, problem } = await api.getChannelBoards(channel.id);

      select.innerHTML = '';
      if (problem || !boards.length) {
        select.append(el('option', null, 'Board tidak bisa dibaca'));
        note.textContent = problem
          ? `Gagal membaca board: ${problem}`
          : 'Akun Pinterest ini belum punya board. Buat dulu satu board di Pinterest.';
        note.style.color = 'var(--bad)';
        return;
      }

      const kosong = el('option', null, '— pilih board —');
      kosong.value = '';
      select.append(kosong);
      for (const board of boards) {
        const opt = el('option', null, board.name);
        opt.value = board.id;
        select.append(opt);
      }
      select.value = selected || '';
      select.disabled = false;

      const sync = () => {
        note.style.color = select.value ? 'var(--ok)' : 'var(--bad)';
        note.textContent = select.value ? 'Board tersimpan.' : 'Belum dipilih — pin ke Pinterest akan ditolak.';
      };
      sync();

      select.onchange = async () => {
        try {
          await api.setChannelSettings(channel.id, { boardId: select.value });
          sync();
        } catch (err) {
          note.style.color = 'var(--bad)';
          note.textContent = `Gagal menyimpan: ${err.message}`;
        }
      };
    } catch (err) {
      select.innerHTML = '';
      select.append(el('option', null, 'Gagal memuat'));
      note.textContent = err.message;
      note.style.color = 'var(--bad)';
    }
  })();

  return box;
}

/** Kumpulkan isian form jadi body request. */
function collectOptions() {
  const pick = (sel, attr) => [...view.querySelectorAll(sel)].filter((c) => c.checked).map((c) => c.dataset[attr]);

  const channelHours = {};
  for (const input of view.querySelectorAll('.channel-hour')) {
    if (input.value) channelHours[input.dataset.channelId] = input.value;
  }

  return {
    videoIds: pick('.video-check', 'videoId'),
    channelIds: pick('.channel-check', 'channelId'),
    hashtagSetIds: pick('.hashtag-check', 'setId'),
    startDate: view.querySelector('#startDate')?.value || todayISO(),
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
    body.append(el('p', 'muted',
      `${result.items.length} post · ${result.videoCount} video × ${result.channelCount} channel × ${result.totalDays} hari · zona waktu ${result.timezone}`));
  } catch (err) {
    body.innerHTML = '';
    body.append(el('div', 'alert alert-bad', `Gagal menghitung pratinjau: ${err.message}`));
  }
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
    th.append(platformDot(row.platform));
    th.append(el('span', 'truncate', ` ${row.label}`));
    th.style.display = 'flex';
    th.style.alignItems = 'center';
    th.style.gap = '6px';
    tr.append(th);

    for (const cell of row.cells) {
      const td = el('td', 'cell');
      td.append(el('span', null, cell.videoTitle || cell.videoId));
      td.append(el('span', 'cell-time', cell.time));
      tr.append(td);
    }
    tbody.append(tr);
  }
  table.append(tbody);
  scroll.append(table);
  return scroll;
}

async function onCreate(e) {
  const options = collectOptions();
  if (!options.videoIds.length) return toast('Pilih minimal satu video.', 'bad');
  if (!options.channelIds.length) return toast('Pilih minimal satu channel.', 'bad');

  const done = busy(e.target, 'Menyimpan…');
  try {
    const { plan, warnings } = await api.createPlan(options);
    if (warnings?.length) toast(warnings[0], 'bad');
    toast('Jadwal tersimpan.', 'ok');
    location.hash = `/jadwal?id=${plan.id}`;
    await renderPlan(plan.id);
  } catch (err) {
    toast(`Gagal menyimpan jadwal: ${err.message}`, 'bad');
  } finally {
    done();
  }
}

async function loadPlanList(container) {
  try {
    const { plans } = await api.listPlans();
    container.innerHTML = '';
    if (!plans.length) {
      container.append(el('p', 'muted', 'Belum ada jadwal tersimpan.'));
      return;
    }
    for (const plan of plans.slice(0, 5)) {
      const row = el('div', 'senditem');
      row.style.gridTemplateColumns = '1fr auto auto';
      const info = el('div');
      info.append(el('div', null, `Mulai ${formatDayLabel(plan.startDate)}`));
      info.append(el('div', 'muted', `${plan.sent}/${plan.total} terkirim${plan.failed ? ` · ${plan.failed} gagal` : ''}`));
      const open = el('a', 'btn btn-ghost btn-sm', 'Buka');
      open.href = `#/jadwal?id=${plan.id}`;
      const badge = el('span', `badge badge-${plan.sent === plan.total ? 'sent' : plan.failed ? 'error' : 'draft'}`,
        plan.sent === plan.total ? 'selesai' : plan.failed ? 'ada gagal' : 'draft');
      row.append(info, badge, open);
      container.append(row);
    }
  } catch (err) {
    container.innerHTML = '';
    container.append(el('p', 'muted', `Gagal memuat: ${err.message}`));
  }
}

// ================= halaman satu jadwal =================

async function renderPlan(planId) {
  view.innerHTML = '';
  const wrap = el('div', 'stack');
  wrap.append(el('p', 'empty', 'Memuat jadwal…'));
  view.append(wrap);

  let plan;
  try {
    ({ plan } = await api.getPlan(planId));
    ({ videos } = await api.listVideos());
  } catch (err) {
    view.innerHTML = '';
    view.append(el('div', 'alert alert-bad', `Gagal memuat jadwal: ${err.message}`));
    return;
  }

  view.innerHTML = '';
  const page = el('div', 'stack');

  // ---------- ringkasan ----------
  const planVideos = plan.videoIds.map((id) => videos.find((v) => v.id === id)).filter(Boolean);
  const needCaption = planVideos.filter((v) => {
    const platforms = [...new Set(plan.items.filter((i) => i.videoId === v.id).map((i) => i.platform))];
    return platforms.some((p) => !v.captions?.[p]?.trim());
  });

  const header = html('section', 'panel', `
    <div class="row-between">
      <div>
        <div class="panel-title" style="margin:0">Jadwal ${escapeHtml(plan.startDate)}</div>
        <div class="muted">${plan.items.length} post · zona waktu ${escapeHtml(plan.timezone)}</div>
      </div>
      <a class="btn btn-ghost btn-sm" href="#/jadwal">Buat baru</a>
    </div>
  `);
  page.append(header);

  // ---------- langkah caption ----------
  const captionPanel = html('section', 'panel', `
    <div class="panel-title">Langkah 1 · Caption</div>
    <p class="hint">AI menuliskan caption per platform. Bisa ditengok & diedit di panel bawah sebelum dikirim.</p>
    <div class="row">
      <button class="btn btn-primary" id="genCaptions">${iconSvg('sparkles', 16)} Generate caption (${needCaption.length} video)</button>
      <span class="muted" id="captionStatus">${
        needCaption.length ? `${needCaption.length} video belum punya caption lengkap` : 'Semua video sudah punya caption'
      }</span>
    </div>
    <div id="captionProgress" class="stack" style="margin-top:10px"></div>
  `);
  page.append(captionPanel);

  captionPanel.querySelector('#genCaptions').onclick = (e) =>
    generateCaptions(e.target, plan, planVideos, captionPanel.querySelector('#captionProgress'));

  // ---------- caption per video (bisa ditengok) ----------
  const editorPanel = html('section', 'panel', `
    <div class="row-between" style="margin-bottom:8px">
      <div class="panel-title" style="margin:0">Tengok & edit caption</div>
      <button class="btn btn-ghost btn-sm" id="toggleEditors">Buka</button>
    </div>
    <div id="editors" class="stack" hidden></div>
  `);
  page.append(editorPanel);

  const editors = editorPanel.querySelector('#editors');
  editorPanel.querySelector('#toggleEditors').onclick = (e) => {
    editors.hidden = !editors.hidden;
    e.target.textContent = editors.hidden ? 'Buka' : 'Tutup';
    if (!editors.hidden && !editors.childElementCount) buildEditors(editors, plan, planVideos);
  };

  // ---------- pengiriman ----------
  const sendPanel = html('section', 'panel', `
    <div class="panel-title">Langkah 2 · Kirim ke Buffer</div>
    <p class="hint">Dikirim satu per satu supaya progresnya kelihatan dan yang gagal bisa diulang sendiri.</p>
    <div class="row" style="margin-bottom:10px">
      <button class="btn btn-primary" id="sendAll">${iconSvg('send', 16)} Kirim semua</button>
      <button class="btn btn-ghost" id="retryFailed">${iconSvg('refresh', 16)} Ulangi yang gagal</button>
      <span class="muted" id="sendStatus"></span>
    </div>
    <div class="sendlist" id="sendList"></div>
  `);
  page.append(sendPanel);

  view.append(page);

  const sendList = sendPanel.querySelector('#sendList');
  paintItems(sendList, plan);
  updateSendStatus(plan);

  sendPanel.querySelector('#sendAll').onclick = (e) =>
    sendItems(e.target, plan, sendList, plan.items.filter((i) => i.status !== 'sent'));
  sendPanel.querySelector('#retryFailed').onclick = (e) =>
    sendItems(e.target, plan, sendList, plan.items.filter((i) => i.status === 'error'));
}

async function generateCaptions(trigger, plan, planVideos, progressBox) {
  const targets = planVideos.filter((v) => {
    const platforms = [...new Set(plan.items.filter((i) => i.videoId === v.id).map((i) => i.platform))];
    return platforms.some((p) => !v.captions?.[p]?.trim());
  });

  if (!targets.length) return toast('Semua video sudah punya caption.', 'ok');

  const done = busy(trigger, 'Menulis…');
  progressBox.innerHTML = '';
  let ok = 0;

  for (const video of targets) {
    const row = el('div', 'senditem');
    row.style.gridTemplateColumns = 'auto 1fr auto';
    const stateIcon = el('span', 'state');
    stateIcon.append(el('span', 'spin'));
    row.append(stateIcon);
    row.append(el('span', 'truncate', video.title || video.filename));
    const state = el('span', 'muted', 'menulis…');
    row.append(state);
    progressBox.append(row);

    try {
      const { captions } = await api.planCaption(plan.id, video.id, video.brief || video.title);
      video.captions = captions;
      row.classList.add('ok');
      stateIcon.innerHTML = iconSvg('check', 16);
      state.textContent = `${Object.keys(captions).length} platform`;
      ok++;
    } catch (err) {
      row.classList.add('err');
      stateIcon.innerHTML = iconSvg('x', 16);
      state.textContent = err.message;
      state.className = 'err-msg';
    }
  }

  done();
  document.getElementById('captionStatus').textContent = `${ok}/${targets.length} video selesai`;
  toast(`Caption selesai untuk ${ok} dari ${targets.length} video.`, ok === targets.length ? 'ok' : 'bad');
}

function buildEditors(container, plan, planVideos) {
  for (const video of planVideos) {
    const platforms = [...new Set(plan.items.filter((i) => i.videoId === video.id).map((i) => i.platform))];

    const box = el('div', 'subcard');
    box.append(el('div', 'panel-title', video.title || video.filename));

    for (const platform of platforms) {
      const field = el('div', 'field');

      const label = el('label', 'lbl');
      label.style.display = 'flex';
      label.style.alignItems = 'center';
      label.style.gap = '6px';
      label.append(platformDot(platform));
      label.append(el('span', 'grow', platform));

      // Pratinjau bergaya platform — untuk mengecek panjang teks & posisi hashtag.
      const previewBox = el('div', 'preview-wrap');
      previewBox.hidden = true;
      const previewBtn = button('btn btn-ghost btn-sm', 'eye', 'Preview');
      previewBtn.type = 'button';
      label.append(previewBtn);
      field.append(label);

      const ta = el('textarea');
      ta.rows = 3;
      ta.value = video.captions?.[platform] || '';
      ta.placeholder = `Caption ${platform}…`;

      const counter = el('span', 'count');
      const syncCount = attachCounter(ta, counter, limitsFor(platform));

      const refreshPreview = () => {
        if (!previewBox.hidden) {
          previewBox.innerHTML = renderPreview(platform, { caption: ta.value, title: video.title || '' });
        }
      };
      previewBtn.onclick = () => {
        previewBox.hidden = !previewBox.hidden;
        previewBtn.innerHTML = '';
        previewBtn.append(icon(previewBox.hidden ? 'eye' : 'eyeOff', 14), el('span', null, previewBox.hidden ? 'Preview' : 'Tutup'));
        refreshPreview();
      };
      ta.addEventListener('input', refreshPreview);

      ta.onchange = async () => {
        video.captions = { ...video.captions, [platform]: ta.value };
        syncCount();
        try {
          await api.updateVideo(video.id, { captions: video.captions });
          toast('Caption tersimpan.', 'ok');
        } catch (err) {
          toast(`Gagal menyimpan: ${err.message}`, 'bad');
        }
      };

      field.append(ta, counter, previewBox);
      box.append(field);
    }
    container.append(box);
  }
}

function paintItems(container, plan) {
  container.innerHTML = '';
  plan.items.forEach((item) => container.append(buildItemRow(item, plan, container)));
}

function buildItemRow(item, plan, container) {
  const row = el('div', `senditem ${item.status === 'sent' ? 'ok' : item.status === 'error' ? 'err' : ''}`);
  row.dataset.index = item.index;

  row.append(html('span', 'state', iconSvg(item.status === 'sent' ? 'check' : item.status === 'error' ? 'x' : 'dot', 16)));

  const body = el('div', 'grow');
  body.append(el('div', 'truncate', `${item.channelLabel} — ${item.videoTitle}`));
  const meta = el('div', 'muted', `${formatDayLabel(item.date)} ${item.time}`);
  body.append(meta);
  if (item.error) body.append(el('div', 'err-msg', item.error));
  row.append(body);

  row.append(el('span', `badge badge-${item.status}`, {
    draft: 'draft', sent: 'terkirim', error: 'gagal'
  }[item.status] || item.status));

  const retry = iconButton('refresh', 'Kirim ulang item ini');
  retry.title = 'Kirim ulang item ini';
  retry.hidden = item.status === 'sent';
  retry.onclick = (e) => sendItems(e.target, plan, container, [item]);
  row.append(retry);

  return row;
}

function updateSendStatus(plan) {
  const node = document.getElementById('sendStatus');
  if (!node) return;
  const sent = plan.items.filter((i) => i.status === 'sent').length;
  const failed = plan.items.filter((i) => i.status === 'error').length;
  node.textContent = `${sent}/${plan.items.length} terkirim${failed ? ` · ${failed} gagal` : ''}`;
}

async function sendItems(trigger, plan, container, items) {
  if (!items.length) return toast('Tidak ada yang perlu dikirim.', 'ok');

  const pending = items.filter((i) => i.status !== 'sent');
  if (!pending.length) return toast('Semuanya sudah terkirim.', 'ok');

  if (pending.length > 1 &&
      !confirm(`Kirim ${pending.length} post ke Buffer sekarang?\n\nIni memakai ${pending.length} request dari kuota harian Buffer.`)) {
    return;
  }

  const done = busy(trigger, `Mengirim 0/${pending.length}`);
  let ok = 0;

  for (const [i, item] of pending.entries()) {
    trigger.innerHTML = `<span class="spin"></span> Mengirim ${i + 1}/${pending.length}`;
    try {
      const { item: updated } = await api.sendPlanItem(plan.id, item.index);
      Object.assign(plan.items[item.index], updated);
      if (updated.status === 'sent') ok++;
    } catch (err) {
      plan.items[item.index].status = 'error';
      plan.items[item.index].error = err.message;
      // Kalau kuota API habis, tidak ada gunanya melanjutkan.
      if (/kuota|rate/i.test(err.message)) {
        toast(err.message, 'bad');
        break;
      }
    }

    const row = container.querySelector(`[data-index="${item.index}"]`);
    if (row) row.replaceWith(buildItemRow(plan.items[item.index], plan, container));
    updateSendStatus(plan);
    document.dispatchEvent(new Event('buffer-usage-changed'));

    // Beri jeda kecil supaya tidak menabrak batas 100 request / 15 menit.
    if (i < pending.length - 1) await sleep(400);
  }

  done();
  toast(`${ok} dari ${pending.length} post terkirim.`, ok === pending.length ? 'ok' : 'bad');
}

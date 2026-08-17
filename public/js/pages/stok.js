/**
 * Stok Video — upload batch, atur judul, minta saran judul SEO, atur urutan.
 * URUTAN DI HALAMAN INI PENTING: itulah urutan V1..Vn yang dipakai rotasi jadwal.
 *
 * Perubahan disimpan otomatis (debounce), TAPI tetap ada tombol Simpan dan
 * penanda status — autosave diam-diam bikin ragu apakah sudah tersimpan.
 */
import * as api from '../api.js';
import {
  el, html, toast, busy, formatBytes, debounce, escapeHtml,
  icon, iconSvg, button, iconButton, videoThumb
} from '../utils.js';

let videos = [];
let links = [];
let listEl = null;

export async function render(view) {
  const wrap = el('div', 'stack');

  // ---------- upload ----------
  const uploadPanel = html('section', 'panel', `
    <div class="dropzone" id="dz" tabindex="0" role="button" aria-label="Pilih atau jatuhkan video">
      ${iconSvg('upload', 26)}
      <div class="dz-main">Ketuk untuk pilih video</div>
      <div class="dz-sub">atau seret beberapa file ke sini sekaligus</div>
    </div>
    <input type="file" id="fileInput" accept="video/*" multiple hidden />
    <div id="uploadQueue" class="vlist" style="margin-top:var(--s3)"></div>
  `);
  wrap.append(uploadPanel);

  // ---------- daftar ----------
  const listPanel = html('section', 'panel', `
    <div class="panel-head">
      <div>
        <div class="panel-title">Stok video</div>
        <p class="muted">Urutan menentukan rotasi jadwal — yang paling atas jadi V1.</p>
      </div>
      <span class="pill-count" id="stokCount">0</span>
    </div>
    <div class="vlist" id="vlist"></div>
  `);
  wrap.append(listPanel);

  view.append(wrap);

  listEl = wrap.querySelector('#vlist');
  setupUpload(wrap);

  await reload();
}

async function reload() {
  const [videoRes, linkRes] = await Promise.allSettled([api.listVideos(), api.listLinks()]);

  if (videoRes.status === 'fulfilled') {
    videos = videoRes.value.videos;
  } else {
    toast(`Gagal memuat stok: ${videoRes.reason.message}`, 'bad');
    videos = [];
  }
  links = linkRes.status === 'fulfilled' ? linkRes.value.links : [];

  paintList();
}

// ================= upload =================

function setupUpload(root) {
  const dz = root.querySelector('#dz');
  const input = root.querySelector('#fileInput');
  const queue = root.querySelector('#uploadQueue');

  const isVideo = (f) => f.type.startsWith('video/') || /\.(mp4|mov|m4v|webm|avi|mkv)$/i.test(f.name);

  async function addFiles(fileList) {
    const files = [...fileList].filter(isVideo);
    const skipped = fileList.length - files.length;
    if (skipped > 0) toast(`${skipped} file dilewati karena bukan video.`, 'bad');
    if (!files.length) return;

    // Berurutan, bukan paralel: upload video besar barengan bikin koneksi HP tercekik.
    for (const file of files) {
      const row = html('div', 'vrow', `
        <span class="vhandle">${iconSvg('upload', 16)}</span>
        <div class="vthumb"></div>
        <div class="vbody">
          <div class="vtitle truncate">${escapeHtml(file.name)}</div>
          <div class="vmeta">${formatBytes(file.size)}<span class="sep">·</span><span class="state">mengupload…</span></div>
          <div class="progress"><div class="bar"></div></div>
        </div>
        <span></span>
      `);
      queue.append(row);
      const bar = row.querySelector('.bar');
      const state = row.querySelector('.state');

      try {
        await api.uploadVideo(file, (p) => { bar.style.width = `${Math.round(p * 100)}%`; });
        row.remove();
      } catch (err) {
        row.querySelector('.progress').remove();
        state.textContent = `Gagal: ${err.message}`;
        state.style.color = 'var(--bad)';
      }
    }

    await reload();
    toast(`${files.length} video ditambahkan ke stok.`, 'ok');
  }

  dz.onclick = () => input.click();
  dz.onkeydown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); }
  };
  input.onchange = () => { addFiles(input.files); input.value = ''; };

  for (const type of ['dragenter', 'dragover']) {
    dz.addEventListener(type, (e) => { e.preventDefault(); dz.classList.add('drag'); });
  }
  for (const type of ['dragleave', 'drop']) {
    dz.addEventListener(type, (e) => { e.preventDefault(); dz.classList.remove('drag'); });
  }
  dz.addEventListener('drop', (e) => addFiles(e.dataTransfer.files));

  // Jangan biarkan browser membuka file kalau drop-nya meleset.
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());
}

// ================= daftar =================

const STATUS_LABEL = { stock: 'stok', scheduled: 'terjadwal', done: 'selesai' };

function paintList() {
  listEl.innerHTML = '';
  const stock = videos.filter((v) => v.status === 'stock').length;
  document.getElementById('stokCount').textContent = `${videos.length} video · ${stock} siap`;

  if (!videos.length) {
    listEl.append(el('p', 'empty', 'Belum ada video. Tambahkan di atas.'));
    return;
  }
  videos.forEach((video, index) => listEl.append(buildRow(video, index)));
}

function buildRow(video, index) {
  const row = el('div', 'vrow vrow-num');
  row.dataset.id = video.id;

  // --- pegangan geser ---
  const handle = el('span', 'vhandle');
  handle.title = 'Seret untuk menggeser urutan';
  handle.draggable = true;
  handle.append(icon('grip', 16));
  attachDrag(row, handle);

  const num = el('span', 'vnum', `V${index + 1}`);
  const thumb = videoThumb(video.path || video.url);
  const body = el('div', 'vbody');

  // --- penanda status simpan, dipakai semua field di kartu ini ---
  const saveState = el('span', 'save-state');
  const setState = (text, kind = '') => {
    saveState.textContent = text;
    saveState.className = `save-state ${kind}`;
  };

  async function persist(patch) {
    setState('Menyimpan…');
    try {
      await api.updateVideo(video.id, patch);
      Object.assign(video, patch);
      setState('Tersimpan', 'ok');
    } catch (err) {
      setState(`Gagal: ${err.message}`, 'bad');
    }
  }

  // --- judul ---
  const titleInput = el('input', 'vtitle-input');
  titleInput.type = 'text';
  titleInput.placeholder = 'Judul video…';
  titleInput.value = video.title || '';
  titleInput.oninput = debounce(() => persist({ title: titleInput.value }), 700);
  body.append(titleInput);

  const meta = el('div', 'vmeta');
  meta.append(el('span', null, formatBytes(video.size)));
  meta.append(el('span', 'sep', '·'));
  const fileLink = el('a');
  fileLink.href = video.path || video.url;
  fileLink.target = '_blank';
  fileLink.rel = 'noopener';
  fileLink.append(icon('link', 13), el('span', null, 'video'));
  meta.append(fileLink);
  meta.append(el('span', 'sep', '·'));
  meta.append(el('span', `badge badge-${video.status}`, STATUS_LABEL[video.status] || video.status));
  if (video.exists === false) {
    const gone = el('span', 'badge badge-error', 'file hilang');
    gone.title = 'Filenya tidak ada lagi di server — kemungkinan volume penyimpanan tidak ter-mount';
    meta.append(gone);
  }
  meta.append(saveState);
  body.append(meta);

  // --- panel rincian ---
  const detail = el('div', 'vdetail');
  detail.hidden = true;

  // brief
  const briefField = el('div', 'field');
  briefField.append(el('label', 'lbl', 'Brief isi video'));
  const brief = el('textarea');
  brief.rows = 2;
  brief.placeholder = 'Dipakai AI untuk membuat judul & caption';
  brief.value = video.brief || '';
  brief.oninput = debounce(() => persist({ brief: brief.value }), 700);
  briefField.append(brief);
  detail.append(briefField);

  // saran judul
  const suggestBtn = button('btn btn-ghost btn-sm', 'sparkles', 'Sarankan judul SEO');
  const suggestions = el('div');

  const showSuggestions = (titles) => {
    suggestions.innerHTML = '';
    if (!titles?.length) return;
    suggestions.style.marginTop = 'var(--s3)';
    suggestions.append(el('p', 'muted', 'Ketuk salah satu untuk dipakai:'));
    const chips = el('div', 'chips');
    chips.style.marginTop = '6px';
    for (const t of titles) {
      const chip = el('button', 'chip', t);
      chip.type = 'button';
      chip.onclick = () => {
        titleInput.value = t;
        persist({ title: t });
      };
      chips.append(chip);
    }
    suggestions.append(chips);
  };
  showSuggestions(video.titleSuggestions);

  suggestBtn.onclick = async () => {
    if (!brief.value.trim()) {
      brief.focus();
      return toast('Isi brief dulu supaya AI tahu isi videonya.', 'bad');
    }
    const done = busy(suggestBtn, 'Meminta AI…');
    suggestions.innerHTML = '';
    try {
      const { titles } = await api.suggestTitle(video.id, brief.value.trim());
      video.titleSuggestions = titles;
      showSuggestions(titles);
      if (!titles.length) toast('AI tidak mengembalikan judul. Coba perjelas brief-nya.', 'bad');
    } catch (err) {
      suggestions.append(buildAIError(err.message));
    } finally {
      done();
    }
  };

  const suggestRow = el('div', 'row');
  suggestRow.append(suggestBtn);
  detail.append(suggestRow, suggestions);

  // tautan
  const linkField = el('div', 'field');
  linkField.style.marginTop = 'var(--s4)';
  linkField.append(el('label', 'lbl', 'Tautan yang disisipkan'));

  const linkSelect = el('select');
  const addOption = (value, label) => {
    const opt = el('option', null, label);
    opt.value = value;
    linkSelect.append(opt);
  };
  addOption('', links.some((l) => l.isDefault) ? 'Pakai tautan utama' : 'Tidak ada tautan');
  for (const l of links) addOption(l.id, `${l.name} — ${l.url.replace(/^https?:\/\//, '').slice(0, 40)}`);
  addOption('__custom', 'Tulis sendiri…');

  const customInput = el('input');
  customInput.type = 'url';
  customInput.placeholder = 'https://…';
  customInput.value = video.link || '';
  customInput.style.marginTop = '6px';

  const isCustom = !video.linkId && !!video.link;
  linkSelect.value = isCustom ? '__custom' : (video.linkId || '');
  customInput.hidden = !isCustom;

  linkSelect.onchange = () => {
    const value = linkSelect.value;
    customInput.hidden = value !== '__custom';
    if (value === '__custom') {
      customInput.focus();
      persist({ linkId: '' });
    } else {
      persist({ linkId: value, link: '' });
      customInput.value = '';
    }
  };
  customInput.oninput = debounce(() => persist({ link: customInput.value, linkId: '' }), 700);

  linkField.append(linkSelect, customInput);

  const linkHint = el('p', 'muted');
  linkHint.style.marginTop = '6px';
  linkHint.textContent = links.length
    ? 'Hanya muncul di Pinterest, YouTube & Facebook.'
    : 'Belum ada tautan tersimpan.';
  if (!links.length) {
    const go = el('a', 'linkbtn', ' Buat di halaman Tautan');
    go.href = '#/tautan';
    linkHint.append(go);
  }
  linkField.append(linkHint);
  detail.append(linkField);

  // tombol simpan eksplisit
  const saveRow = el('div', 'row');
  saveRow.style.marginTop = 'var(--s4)';
  const saveBtn = button('btn btn-primary btn-sm', 'check', 'Simpan');
  saveBtn.onclick = async () => {
    const done = busy(saveBtn, 'Menyimpan…');
    const patch = { title: titleInput.value, brief: brief.value };
    if (linkSelect.value === '__custom') {
      patch.link = customInput.value;
      patch.linkId = '';
    } else {
      patch.linkId = linkSelect.value;
      patch.link = '';
    }
    await persist(patch);
    done();
    toast('Perubahan tersimpan.', 'ok');
  };
  saveRow.append(saveBtn, el('span', 'muted', 'Perubahan juga tersimpan otomatis.'));
  detail.append(saveRow);

  body.append(detail);

  // --- aksi ---
  const actions = el('div', 'vactions');
  const expandBtn = iconButton('chevronDown', 'Brief, saran judul & tautan');
  expandBtn.onclick = () => {
    detail.hidden = !detail.hidden;
    expandBtn.innerHTML = '';
    expandBtn.append(icon(detail.hidden ? 'chevronDown' : 'chevronUp', 16));
  };

  const delBtn = iconButton('trash', 'Hapus video', 'icon-btn danger');
  delBtn.onclick = async () => {
    if (!confirm(`Hapus "${video.title || video.filename}"? File videonya ikut terhapus.`)) return;
    try {
      await api.deleteVideo(video.id);
      videos = videos.filter((v) => v.id !== video.id);
      paintList();
      toast('Video dihapus.', 'ok');
    } catch (err) {
      toast(`Gagal menghapus: ${err.message}`, 'bad');
    }
  };
  actions.append(expandBtn, delBtn);

  row.append(handle, num, thumb, body, actions);
  return row;
}

/** Kotak error AI lengkap dengan tombol diagnosa — biar jelas apa yang salah. */
function buildAIError(message) {
  const box = el('div', 'alert alert-bad');
  box.style.marginTop = 'var(--s3)';
  box.append(icon('alert', 15));

  const inner = el('div', 'grow');
  inner.append(el('div', null, message));

  const testBtn = el('button', 'linkbtn', 'Cek koneksi AI');
  testBtn.style.marginTop = '6px';
  testBtn.onclick = async () => {
    const done = busy(testBtn, 'Mengecek…');
    try {
      const result = await api.testAI();
      const detail = el('pre');
      detail.style.marginTop = '8px';
      detail.textContent = result.ok
        ? `Koneksi AI normal.\nBalasan: ${result.reply}\nModel: ${result.config.model || '(tidak diset)'}`
        : `Gagal: ${result.error}\n\nSetelan sekarang:\n` +
          `  URL   : ${result.config.url || '(kosong)'}\n` +
          `  Key   : ${result.config.hasKey ? 'terisi' : '(kosong)'}\n` +
          `  Model : ${result.config.model || '(kosong)'}`;
      inner.append(detail);
      testBtn.remove();
    } catch (err) {
      toast(`Gagal mengecek: ${err.message}`, 'bad');
    } finally {
      done();
    }
  };
  inner.append(testBtn);

  box.append(inner);
  return box;
}

// ================= geser urutan =================

let dragId = null;

function attachDrag(row, handle) {
  handle.addEventListener('dragstart', (e) => {
    dragId = row.dataset.id;
    row.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    // Firefox butuh data terisi supaya drag-nya jalan.
    e.dataTransfer.setData('text/plain', dragId);
  });

  handle.addEventListener('dragend', () => {
    row.classList.remove('dragging');
    dragId = null;
    for (const r of listEl.children) r.classList?.remove('drop-target');
  });

  row.addEventListener('dragover', (e) => {
    if (!dragId || dragId === row.dataset.id) return;
    e.preventDefault();
    row.classList.add('drop-target');
  });

  row.addEventListener('dragleave', () => row.classList.remove('drop-target'));

  row.addEventListener('drop', async (e) => {
    e.preventDefault();
    row.classList.remove('drop-target');
    if (!dragId || dragId === row.dataset.id) return;

    const from = videos.findIndex((v) => v.id === dragId);
    const to = videos.findIndex((v) => v.id === row.dataset.id);
    if (from === -1 || to === -1) return;

    const [moved] = videos.splice(from, 1);
    videos.splice(to, 0, moved);
    paintList();

    try {
      await api.reorderVideos(videos.map((v) => v.id));
    } catch (err) {
      toast(`Urutan gagal disimpan: ${err.message}`, 'bad');
      await reload();
    }
  });
}

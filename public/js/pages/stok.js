/**
 * Stok Video — upload batch, atur judul, minta saran judul SEO, atur urutan.
 * URUTAN DI HALAMAN INI PENTING: itulah urutan V1..Vn yang dipakai rotasi jadwal.
 */
import * as api from '../api.js';
import { el, html, toast, busy, formatBytes, debounce, escapeHtml } from '../utils.js';

let videos = [];
let listEl = null;

export async function render(view) {
  const wrap = el('div', 'stack');

  // ---------- upload ----------
  const uploadPanel = html('section', 'panel', `
    <div class="panel-title">Tambah video</div>
    <div class="dropzone" id="dz" tabindex="0" role="button" aria-label="Pilih atau jatuhkan video">
      <div class="dz-icon">🎬</div>
      <div class="dz-main">Ketuk untuk pilih video</div>
      <div class="dz-sub">atau seret beberapa file ke sini sekaligus</div>
    </div>
    <input type="file" id="fileInput" accept="video/*" multiple hidden />
    <div id="uploadQueue" class="stack" style="margin-top:12px"></div>
  `);
  wrap.append(uploadPanel);

  // ---------- daftar ----------
  const listPanel = html('section', 'panel', `
    <div class="row-between" style="margin-bottom:10px">
      <div class="panel-title" style="margin:0">Stok video</div>
      <span class="muted" id="stokCount"></span>
    </div>
    <p class="hint">Urutannya menentukan rotasi jadwal: video paling atas jadi V1. Seret ikon ⠿ untuk menggeser.</p>
    <div class="vlist" id="vlist"></div>
  `);
  wrap.append(listPanel);

  view.append(wrap);

  listEl = wrap.querySelector('#vlist');
  setupUpload(wrap);

  await reload();
}

async function reload() {
  try {
    ({ videos } = await api.listVideos());
  } catch (err) {
    toast(`Gagal memuat stok: ${err.message}`, 'bad');
    videos = [];
  }
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
        <span class="vhandle">⬆</span>
        <div class="vthumb" style="display:grid;place-items:center;color:#94a3b8;font-size:11px">…</div>
        <div class="vbody">
          <div class="vtitle truncate">${escapeHtml(file.name)}</div>
          <div class="vmeta">${formatBytes(file.size)} · mengupload…</div>
          <div class="progress"><div class="bar"></div></div>
        </div>
        <span></span>
      `);
      queue.append(row);
      const bar = row.querySelector('.bar');
      const meta = row.querySelector('.vmeta');

      try {
        await api.uploadVideo(file, (p) => { bar.style.width = `${Math.round(p * 100)}%`; });
        meta.textContent = 'selesai';
        row.remove();
      } catch (err) {
        row.querySelector('.progress').remove();
        meta.innerHTML = `<span style="color:#b91c1c">Gagal: ${escapeHtml(err.message)}</span>`;
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

function paintList() {
  listEl.innerHTML = '';
  document.getElementById('stokCount').textContent =
    `${videos.length} video · ${videos.filter((v) => v.status === 'stock').length} siap dijadwalkan`;

  if (!videos.length) {
    listEl.append(el('p', 'empty', 'Belum ada video. Tambahkan di atas.'));
    return;
  }

  videos.forEach((video, index) => listEl.append(buildRow(video, index)));
}

function buildRow(video, index) {
  const row = el('div', 'vrow');
  row.draggable = false;
  row.dataset.id = video.id;

  // --- pegangan geser ---
  const handle = el('span', 'vhandle', '⠿');
  handle.title = 'Seret untuk menggeser urutan';
  handle.draggable = true;
  attachDrag(row, handle);

  const num = el('span', 'vnum', `V${index + 1}`);

  // --- thumbnail ---
  const thumb = el('video', 'vthumb');
  thumb.src = video.url;
  thumb.muted = true;
  thumb.playsInline = true;
  thumb.preload = 'metadata';

  // --- badan ---
  const body = el('div', 'vbody');

  const titleInput = el('input', 'vtitle-input');
  titleInput.type = 'text';
  titleInput.placeholder = 'Judul video…';
  titleInput.value = video.title || '';
  const saveTitle = debounce(async () => {
    try {
      await api.updateVideo(video.id, { title: titleInput.value });
      video.title = titleInput.value;
    } catch (err) {
      toast(`Judul gagal disimpan: ${err.message}`, 'bad');
    }
  }, 600);
  titleInput.oninput = saveTitle;
  body.append(titleInput);

  const meta = el('div', 'vmeta');
  meta.append(el('span', null, formatBytes(video.size)));
  const link = el('a', null, 'link video');
  link.href = video.url;
  link.target = '_blank';
  link.rel = 'noopener';
  meta.append(link);
  const badge = el('span', `badge badge-${video.status}`, {
    stock: 'stok', scheduled: 'terjadwal', done: 'selesai'
  }[video.status] || video.status);
  meta.append(badge);
  body.append(meta);

  // --- panel brief + saran judul ---
  const detail = el('div', 'stack');
  detail.hidden = true;
  detail.style.marginTop = '10px';

  const brief = el('textarea');
  brief.rows = 2;
  brief.placeholder = 'Brief singkat isi video — dipakai AI untuk bikin judul & caption';
  brief.value = video.brief || '';
  const saveBrief = debounce(async () => {
    try {
      await api.updateVideo(video.id, { brief: brief.value });
      video.brief = brief.value;
    } catch (err) {
      toast(`Brief gagal disimpan: ${err.message}`, 'bad');
    }
  }, 600);
  brief.oninput = saveBrief;
  detail.append(brief);

  const suggestBtn = el('button', 'btn btn-ghost btn-sm', '✨ Sarankan judul SEO');
  const suggestions = el('div', 'chips');

  const showSuggestions = (titles) => {
    suggestions.innerHTML = '';
    if (!titles?.length) return;
    suggestions.append(el('div', 'muted', 'Ketuk salah satu untuk dipakai:'));
    for (const t of titles) {
      const chip = el('button', 'chip', t);
      chip.type = 'button';
      chip.onclick = async () => {
        titleInput.value = t;
        try {
          await api.updateVideo(video.id, { title: t });
          video.title = t;
          toast('Judul dipakai.', 'ok');
        } catch (err) {
          toast(`Gagal menyimpan judul: ${err.message}`, 'bad');
        }
      };
      suggestions.append(chip);
    }
  };
  showSuggestions(video.titleSuggestions);

  suggestBtn.onclick = async () => {
    if (!brief.value.trim()) {
      brief.focus();
      return toast('Isi brief dulu supaya AI tahu isi videonya.', 'bad');
    }
    const done = busy(suggestBtn, 'Meminta AI…');
    try {
      const { titles } = await api.suggestTitle(video.id, brief.value.trim());
      video.titleSuggestions = titles;
      showSuggestions(titles);
      if (!titles.length) toast('AI tidak mengembalikan judul. Coba perjelas brief-nya.', 'bad');
    } catch (err) {
      toast(`Gagal minta saran judul: ${err.message}`, 'bad');
    } finally {
      done();
    }
  };

  const suggestRow = el('div', 'row');
  suggestRow.append(suggestBtn);
  detail.append(suggestRow, suggestions);
  body.append(detail);

  // --- aksi ---
  const actions = el('div', 'vactions');
  const expandBtn = el('button', 'icon-btn', '⌄');
  expandBtn.title = 'Brief & saran judul';
  expandBtn.onclick = () => {
    detail.hidden = !detail.hidden;
    expandBtn.textContent = detail.hidden ? '⌄' : '⌃';
  };
  const delBtn = el('button', 'icon-btn', '🗑');
  delBtn.title = 'Hapus video';
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

  row.classList.add('vrow-num'); // ada kolom nomor V1..Vn
  row.append(handle, num, thumb, body, actions);
  return row;
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

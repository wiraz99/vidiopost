/**
 * Stok Video — upload batch, atur judul, minta saran judul SEO, atur urutan.
 * URUTAN DI HALAMAN INI PENTING: itulah urutan V1..Vn yang dipakai rotasi jadwal.
 */
import * as api from '../api.js';
import {
  el, html, toast, busy, formatBytes, debounce, escapeHtml,
  icon, iconSvg, button, iconButton, videoThumb
} from '../utils.js';

let videos = [];
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

  const thumb = videoThumb(video.url);

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
  meta.append(el('span', 'sep', '·'));
  const link = el('a');
  link.href = video.url;
  link.target = '_blank';
  link.rel = 'noopener';
  link.append(icon('link', 13), el('span', null, 'video'));
  meta.append(link);
  meta.append(el('span', 'sep', '·'));
  meta.append(el('span', `badge badge-${video.status}`, STATUS_LABEL[video.status] || video.status));
  body.append(meta);

  // --- panel brief + saran judul + link ---
  const detail = el('div');
  detail.hidden = true;
  detail.style.marginTop = 'var(--s4)';
  detail.style.paddingTop = 'var(--s4)';
  detail.style.borderTop = '1px solid var(--line)';

  const briefField = el('div', 'field');
  briefField.append(el('label', 'lbl', 'Brief isi video'));
  const brief = el('textarea');
  brief.rows = 2;
  brief.placeholder = 'Dipakai AI untuk membuat judul & caption';
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
  briefField.append(brief);
  detail.append(briefField);

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

  // Link tujuan — khusus dipakai Pinterest, ditaruh di baris terakhir pin.
  const linkField = el('div', 'field');
  linkField.style.marginTop = 'var(--s4)';
  linkField.append(el('label', 'lbl', 'Link tujuan (dipakai Pinterest)'));
  const linkInput = el('input');
  linkInput.type = 'url';
  linkInput.placeholder = 'https://… halaman produk / WhatsApp';
  linkInput.value = video.link || '';
  const saveLink = debounce(async () => {
    try {
      await api.updateVideo(video.id, { link: linkInput.value });
      video.link = linkInput.value;
    } catch (err) {
      toast(`Link gagal disimpan: ${err.message}`, 'bad');
    }
  }, 600);
  linkInput.oninput = saveLink;
  linkField.append(linkInput);
  detail.append(linkField);

  body.append(detail);

  // --- aksi ---
  const actions = el('div', 'vactions');
  const expandBtn = iconButton('chevronDown', 'Brief, saran judul & link');
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

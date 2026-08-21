/**
 * Tautan — bank link yang dipakai berulang: marketplace, WhatsApp, katalog.
 *
 * Link dari sini disisipkan otomatis ke post di platform yang memang
 * memerlukannya (link tujuan Pinterest, tautan di deskripsi YouTube & Facebook).
 * Di TikTok & Instagram sengaja tidak disisipkan — di sana link tidak bisa
 * diklik dan cuma jadi sampah teks.
 */
import * as api from '../api.js';
import { el, html, toast, busy, escapeHtml, iconSvg, icon, button, iconButton } from '../utils.js';
import { PLATFORM_META } from '../config.js';

const PLATFORMS = Object.keys(PLATFORM_META).filter((p) => p !== 'default');

// Platform yang benar-benar menampilkan link — harus sama dengan
// LINK_PLATFORMS di lib/compose.js.
const LINK_PLATFORMS = ['pinterest', 'youtube', 'facebook'];

// Tombol cepat: cuma mengisi nama, URL-nya tetap kamu yang isi.
const PRESETS = ['Shopee', 'Tokopedia', 'TikTok Shop', 'WhatsApp', 'Katalog', 'Instagram'];

let links = [];
let listEl = null;

export async function render(view) {
  const wrap = el('div', 'stack');

  wrap.append(html('section', 'panel', `
    <div class="panel-head">
      <div>
        <div class="panel-title">Tautan tersimpan</div>
        <p class="muted">Disisipkan otomatis ke post di ${LINK_PLATFORMS.map((p) => PLATFORM_META[p].name).join(', ')}.</p>
      </div>
      <span class="pill-count" id="linkCount">0</span>
    </div>
    <div class="stack" id="linkList"></div>
  `));

  wrap.append(buildCreatePanel());

  wrap.append(html('section', 'panel', `
    <div class="panel-title">Cara kerjanya</div>
    <ul class="muted" style="margin:0;padding-left:18px;line-height:1.9">
      <li>Tautan bertanda <b>utama</b> dipakai kalau sebuah video tidak memilih tautan tertentu.</li>
      <li>Di halaman <a href="#/stok">Stok Video</a>, tiap video bisa memilih tautannya sendiri.</li>
      <li>Tautan yang dibatasi ke platform tertentu hanya ikut di platform itu.</li>
      <li>TikTok &amp; Instagram tidak disisipi link karena tidak bisa diklik di sana.</li>
    </ul>
  `));

  view.append(wrap);
  listEl = wrap.querySelector('#linkList');

  await reload();
}

async function reload() {
  try {
    ({ links } = await api.listLinks());
  } catch (err) {
    toast(`Gagal memuat tautan: ${err.message}`, 'bad');
    links = [];
  }
  paint();
}

function paint() {
  listEl.innerHTML = '';
  document.getElementById('linkCount').textContent = `${links.length}`;

  if (!links.length) {
    listEl.append(el('p', 'empty', 'Belum ada tautan. Tambahkan di bawah.'));
    return;
  }
  for (const link of links) listEl.append(buildCard(link));
}

function buildCard(link) {
  const card = el('div', 'subcard');

  // --- baris atas: nama + tanda utama + hapus ---
  const head = el('div', 'row-between');

  const nameInput = el('input');
  nameInput.type = 'text';
  nameInput.value = link.name;
  nameInput.style.fontWeight = '600';
  nameInput.style.maxWidth = '240px';

  const actions = el('div', 'row');

  const mainChip = el('label', `chip${link.isDefault ? ' on' : ''}`);
  const mainCb = el('input');
  mainCb.type = 'checkbox';
  mainCb.checked = !!link.isDefault;
  mainChip.title = 'Dipakai kalau video tidak memilih tautan sendiri';
  mainChip.append(mainCb, el('span', null, 'utama'));

  const delBtn = iconButton('trash', 'Hapus tautan', 'icon-btn danger');
  delBtn.onclick = async () => {
    if (!confirm(`Hapus tautan "${link.name}"?`)) return;
    try {
      await api.deleteLink(link.id);
      links = links.filter((l) => l.id !== link.id);
      paint();
      toast('Tautan dihapus.', 'ok');
    } catch (err) {
      toast(`Gagal menghapus: ${err.message}`, 'bad');
    }
  };

  actions.append(mainChip, delBtn);
  head.append(nameInput, actions);
  card.append(head);

  // --- URL ---
  const urlField = el('div', 'field');
  urlField.style.marginTop = 'var(--s3)';
  urlField.append(el('label', 'lbl', 'Alamat'));
  const urlInput = el('input');
  urlInput.type = 'url';
  urlInput.value = link.url;
  urlInput.placeholder = 'https://…';
  urlField.append(urlInput);

  const openRow = el('div', 'row');
  openRow.style.marginTop = '6px';
  const open = el('a', 'linkbtn', 'Buka untuk mengecek');
  open.href = link.url;
  open.target = '_blank';
  open.rel = 'noopener';
  openRow.append(open);
  urlField.append(openRow);

  // Pinterest satu-satunya platform yang memakai link sebagai TUJUAN pin, dan
  // menolak link pendek dengan pesan "Unknown error" yang tidak menjelaskan
  // apa pun. Ditandai di sini supaya ketahuan sebelum jadwal dibuat.
  if (link.pinterest?.blokir) {
    urlField.append(html('div', 'alert alert-bad',
      `<div><b>Ditolak Pinterest.</b><div style="margin-top:4px">${escapeHtml(link.pinterest.blokir)}</div></div>`));
  } else if (link.pinterest?.peringatan) {
    urlField.append(html('div', 'alert alert-warn',
      `<div>${escapeHtml(link.pinterest.peringatan)}</div>`));
  }

  card.append(urlField);

  // --- catatan ---
  const noteField = el('div', 'field');
  noteField.append(el('label', 'lbl', 'Catatan (opsional)'));
  const noteInput = el('input');
  noteInput.type = 'text';
  noteInput.value = link.note || '';
  noteInput.placeholder = 'mis. khusus promo bulan ini';
  noteField.append(noteInput);
  card.append(noteField);

  // --- batasan platform ---
  const platField = el('div', 'field');
  platField.append(el('label', 'lbl', 'Batasi ke platform (kosongkan = semua)'));
  const chips = el('div', 'chips');
  const boxes = [];
  for (const platform of PLATFORMS) {
    const usable = LINK_PLATFORMS.includes(platform);
    const chip = el('label', `chip${link.platforms?.includes(platform) ? ' on' : ''}`);
    const cb = el('input');
    cb.type = 'checkbox';
    cb.checked = !!link.platforms?.includes(platform);
    cb.dataset.platform = platform;
    cb.onchange = () => chip.classList.toggle('on', cb.checked);
    chip.append(cb, el('span', null, PLATFORM_META[platform].name));
    if (!usable) {
      chip.style.opacity = '.5';
      chip.title = `${PLATFORM_META[platform].name} tidak menampilkan link, jadi tidak berpengaruh`;
    }
    chips.append(chip);
    boxes.push(cb);
  }
  platField.append(chips);
  card.append(platField);

  // --- simpan ---
  const saveBtn = button('btn btn-ghost btn-sm', 'check', 'Simpan perubahan');
  saveBtn.onclick = async () => {
    const done = busy(saveBtn, 'Menyimpan…');
    try {
      const { link: updated } = await api.updateLink(link.id, {
        name: nameInput.value,
        url: urlInput.value,
        note: noteInput.value,
        platforms: boxes.filter((c) => c.checked).map((c) => c.dataset.platform),
        isDefault: mainCb.checked
      });
      Object.assign(link, updated);
      urlInput.value = updated.url;
      open.href = updated.url;
      // Hanya boleh ada satu tautan utama — muat ulang supaya tanda di kartu lain ikut turun.
      if (updated.isDefault) await reload();
      toast('Tersimpan.', 'ok');
    } catch (err) {
      toast(`Gagal menyimpan: ${err.message}`, 'bad');
    } finally {
      done();
    }
  };
  card.append(saveBtn);

  return card;
}

// ================= tambah baru =================

function buildCreatePanel() {
  const panel = html('section', 'panel', `
    <div class="panel-title">Tambah tautan</div>
    <div class="field-row cols-2">
      <div class="field">
        <label class="lbl" for="newName">Nama</label>
        <input type="text" id="newName" placeholder="mis. Shopee Arachynana" />
      </div>
      <div class="field">
        <label class="lbl" for="newUrl">Alamat</label>
        <input type="url" id="newUrl" placeholder="https://shopee.co.id/…" />
      </div>
    </div>
    <div class="field">
      <label class="lbl">Isi cepat namanya</label>
      <div class="chips" id="presets"></div>
    </div>
    <label class="chip" style="margin-bottom:var(--s4)">
      <input type="checkbox" id="newDefault" />
      <span>Jadikan tautan utama</span>
    </label>
    <button class="btn btn-primary btn-block" id="addBtn">${iconSvg('plus', 16)} Tambah tautan</button>
  `);

  const nameInput = panel.querySelector('#newName');
  const urlInput = panel.querySelector('#newUrl');
  const defaultCb = panel.querySelector('#newDefault');
  const presets = panel.querySelector('#presets');

  for (const preset of PRESETS) {
    const chip = el('button', 'chip', preset);
    chip.type = 'button';
    chip.onclick = () => {
      nameInput.value = preset;
      urlInput.focus();
    };
    presets.append(chip);
  }

  panel.querySelector('#addBtn').onclick = async (e) => {
    if (!nameInput.value.trim()) { nameInput.focus(); return toast('Nama tautan wajib diisi.', 'bad'); }
    if (!urlInput.value.trim()) { urlInput.focus(); return toast('Alamatnya wajib diisi.', 'bad'); }

    const done = busy(e.currentTarget, 'Menambahkan…');
    try {
      await api.createLink({
        name: nameInput.value,
        url: urlInput.value,
        isDefault: defaultCb.checked
      });
      nameInput.value = '';
      urlInput.value = '';
      defaultCb.checked = false;
      await reload();
      toast('Tautan ditambahkan.', 'ok');
    } catch (err) {
      toast(`Gagal menambahkan: ${err.message}`, 'bad');
    } finally {
      done();
    }
  };

  return panel;
}

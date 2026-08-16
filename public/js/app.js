import * as api from './api.js';
import { state, createCard, emitQueueChange } from './state.js';
import { createCardEl } from './card.js';
import { initQueueBar } from './queuebar.js';
import { initHistory } from './history.js';
import { QUEUE_LIMIT } from './config.js';

const $ = (sel) => document.querySelector(sel);

const dropzone = $('#dropzone');
const fileInput = $('#fileInput');
const cardsEl = $('#cards');
const emptyCards = $('#emptyCards');
const bootError = $('#bootError');

let history = null;
const cardEls = new Map();

// ---------- boot ----------
(async function boot() {
  try {
    state.channels = await api.getChannels();
  } catch (err) {
    bootError.hidden = false;
    bootError.textContent = `Gagal memuat daftar channel: ${err.message}`;
    return;
  }

  try {
    const q = await api.getQueue();
    state.queue = { limit: q.limit || QUEUE_LIMIT, counts: q.counts || {} };
  } catch {
    state.queue = { limit: QUEUE_LIMIT, counts: {} };
  }

  initQueueBar($('#queueBar'));
  history = initHistory($('#historyList'), $('#historyEmpty'));
  $('#historyRefresh').onclick = () => history.reload();
})();

// ---------- tambah video ----------
function addFiles(fileList) {
  const files = [...fileList].filter((f) => f.type.startsWith('video/') || /\.(mp4|mov|m4v|webm|avi|mkv)$/i.test(f.name));
  const rejected = fileList.length - files.length;
  if (rejected > 0) alert(`${rejected} file dilewati karena bukan video.`);
  if (!files.length) return;

  if (!state.channels.length) return alert('Daftar channel belum termuat, coba refresh halaman.');

  for (const file of files) {
    const card = createCard(file);
    state.cards.push(card);
    const { root } = createCardEl(card, { onRemove: removeCard, onHistoryChange: () => history?.reload() });
    cardEls.set(card.id, root);
    cardsEl.append(root);
  }
  emptyCards.hidden = true;
  emitQueueChange();
}

function removeCard(card) {
  if (card.status === 'publishing') return alert('Tunggu sampai proses publish selesai.');
  if ((card.status === 'ready' || card.status === 'partial') && !confirm(`Hapus kartu "${card.filename}"?`)) return;

  URL.revokeObjectURL(card.objectUrl);
  state.cards = state.cards.filter((c) => c.id !== card.id);
  cardEls.get(card.id)?.remove();
  cardEls.delete(card.id);
  emptyCards.hidden = state.cards.length > 0;
  emitQueueChange();
}

fileInput.onchange = () => {
  addFiles(fileInput.files);
  fileInput.value = '';
};

dropzone.onclick = () => fileInput.click();
dropzone.onkeydown = (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    fileInput.click();
  }
};

for (const type of ['dragenter', 'dragover']) {
  dropzone.addEventListener(type, (e) => {
    e.preventDefault();
    dropzone.classList.add('drag');
  });
}
for (const type of ['dragleave', 'drop']) {
  dropzone.addEventListener(type, (e) => {
    e.preventDefault();
    dropzone.classList.remove('drag');
  });
}
dropzone.addEventListener('drop', (e) => addFiles(e.dataTransfer.files));

// cegah browser membuka file kalau drop meleset dari dropzone
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());

// peringatan kalau menutup tab saat masih ada proses berjalan
window.addEventListener('beforeunload', (e) => {
  const busy = state.cards.some((c) => c.status === 'uploading' || c.status === 'publishing');
  if (busy) {
    e.preventDefault();
    e.returnValue = '';
  }
});

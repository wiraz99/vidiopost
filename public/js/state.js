import { HASHTAG_BANK, QUEUE_LIMIT } from './config.js';
import { uid } from './utils.js';

export const state = {
  channels: [],
  queue: { limit: QUEUE_LIMIT, counts: {} },
  cards: [],           // lihat createCard()
  history: []
};

const listeners = new Set();
export const onQueueChange = (fn) => listeners.add(fn);
export const emitQueueChange = () => listeners.forEach((fn) => fn());

export const channelById = (id) => state.channels.find((c) => c.id === id);

export function createCard(file) {
  return {
    id: uid(),
    file,
    filename: file.name,
    size: file.size,
    objectUrl: URL.createObjectURL(file),
    url: null,                       // diisi setelah upload sukses
    status: 'pending',               // pending|uploading|ready|publishing|published|partial|failed
    progress: 0,
    error: null,
    brief: '',
    generating: false,
    // hashtag aktif untuk video ini (bisa dimatikan per video)
    hashtags: new Set(HASHTAG_BANK.filter((h) => h.default).map((h) => h.tag)),
    hashtagsOn: true,
    // channel yang dipilih (default: semua)
    selected: new Set(),
    // isi per channel: { caption, title, link }
    fields: {},
    // hasil publish per channel: { ok, error, pending }
    results: {},
    historyId: null
  };
}

export function fieldsOf(card, channelId) {
  if (!card.fields[channelId]) card.fields[channelId] = { caption: '', title: '', link: '' };
  return card.fields[channelId];
}

// Berapa kartu (yang belum sukses terkirim) yang menargetkan channel ini.
export function plannedCount(channelId, exceptCardId = null) {
  return state.cards.filter(
    (c) =>
      c.id !== exceptCardId &&
      c.selected.has(channelId) &&
      !c.results[channelId]?.ok
  ).length;
}

export const usedCount = (channelId) => state.queue.counts[channelId] || 0;
export const remainingSlots = (channelId) => state.queue.limit - usedCount(channelId);

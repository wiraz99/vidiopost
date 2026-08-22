/** Pembungkus tipis semua endpoint server. Semua error dilempar sebagai Error biasa. */
import { idAktif } from './grup.js';

/**
 * Sesi habis di tengah jalan itu wajar (cookie kedaluwarsa, kata sandi
 * diganti dari peramban lain, server direstart dengan rahasia baru).
 * Kalau itu terjadi, jangan tampilkan pesan error yang membingungkan —
 * langsung antar ke halaman masuk.
 */
function keLogin() {
  if (location.pathname !== '/login') location.href = '/login';
}

async function parse(res) {
  let data = null;
  try {
    data = await res.json();
  } catch {
    // biarkan null
  }
  if (res.status === 401 || data?.perluLogin || data?.perluSetup) {
    keLogin();
    throw new Error(data?.error || 'Sesi habis, silakan masuk lagi.');
  }
  if (!res.ok) throw new Error(data?.error || data?.detail || `HTTP ${res.status}`);
  return data;
}

const get = (url) => fetch(url).then(parse);
const send = (method) => (url, body) =>
  fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  }).then(parse);

const post = send('POST');
const patch = send('PATCH');
const del = send('DELETE');

/**
 * Bangun URL yang SELALU membawa grup aktif.
 *
 * Penyaringan dikerjakan server, bukan di sini: satu aturan untuk semua
 * pemanggil, dan pemanggil yang lupa menyaring tidak bisa membocorkan isi grup
 * lain ke layar. Isi `params` yang kosong dibuang supaya URL-nya tetap bersih.
 */
function url(path, params = {}) {
  const q = new URLSearchParams();
  const grup = idAktif();
  if (grup) q.set('grup', grup);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '' && v !== false) q.set(k, v === true ? '1' : v);
  }
  const s = q.toString();
  return s ? `${path}?${s}` : path;
}

/** Yang perlu melihat lintas grup (halaman Pengaturan) memakai ini. */
const urlSemua = (path, params = {}) => {
  const q = new URLSearchParams({ grup: 'semua' });
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '' && v !== false) q.set(k, v === true ? '1' : v);
  }
  return `${path}?${q}`;
};

// ---------- grup ----------
export const listGroups = () => get('/api/groups');
export const createGroup = (body) => post('/api/groups', body);
export const updateGroup = (id, body) => patch(`/api/groups/${id}`, body);
export const deleteGroup = (id) => del(`/api/groups/${id}`);
export const assignChannels = (groupId, channelIds) =>
  post(`/api/groups/${groupId}/channels`, { channelIds });

// ---------- upload ----------
/** /api/upload menerima satu file per request, jadi batch = beberapa request. */
export function uploadVideo(file, onProgress) {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    fd.append('video', file);

    const xhr = new XMLHttpRequest();
    // Video langsung jadi milik grup yang sedang aktif — bukan grup bawaan.
    xhr.open('POST', url('/api/upload'));
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      let data = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        // biarkan null
      }
      if (xhr.status === 401) {
        keLogin();
        reject(new Error('Sesi habis, silakan masuk lagi.'));
        return;
      }
      if (xhr.status >= 200 && xhr.status < 300 && data?.url) resolve(data);
      else reject(new Error(data?.error || `Upload gagal (HTTP ${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error('Koneksi terputus saat upload'));
    xhr.send(fd);
  });
}

// ---------- video ----------
export const listVideos = (status) => get(url('/api/videos', { status }));
export const updateVideo = (id, patchBody) => patch(`/api/videos/${id}`, patchBody);
export const deleteVideo = (id) => del(`/api/videos/${id}`);
export const reorderVideos = (ids) => post('/api/videos/reorder', { ids });
export const suggestTitle = (id, brief, count) => post(`/api/videos/${id}/suggest-title`, { brief, count });

// ---------- channel & kuota ----------
export const getChannels = () => get(url('/api/channels'));
export const getChannelsDetail = (refresh) => get(url('/api/channels/detail', { refresh }));
/** Semua channel lintas grup — hanya untuk halaman Pengaturan. */
export const getChannelsAll = (refresh) => get(urlSemua('/api/channels/detail', { refresh }));
export const getQueue = () => get(url('/api/queue'));
export const getChannelBoards = (id, refresh) => get(`/api/channels/${id}/boards${refresh ? '?refresh=1' : ''}`);
export const setChannelSettings = (id, body) => patch(`/api/channels/${id}/settings`, body);
/** Balasan mentah Buffer untuk pembacaan board — dipakai kalau board tak terbaca. */
export const diagnoseChannelBoards = (id) => get(`/api/channels/${id}/boards?refresh=1&diagnosa=1`);
export const getUsage = () => get('/api/usage');
export const getHealth = () => get('/api/health');

// ---------- hashtag ----------
export const listHashtags = () => get(url('/api/hashtags'));
export const createHashtagSet = (body) => post('/api/hashtags', body);
export const updateHashtagSet = (id, body) => patch(`/api/hashtags/${id}`, body);
export const deleteHashtagSet = (id) => del(`/api/hashtags/${id}`);
export const suggestHashtags = (brief, platform, count) =>
  post('/api/hashtags/suggest', { brief, platform, count, groupId: idAktif() });

// ---------- jadwal ----------
// groupId ikut dikirim supaya server bisa menolak jadwal yang mencampur grup —
// pemeriksaan itu tidak boleh bergantung pada tampilan saja.
export const previewPlan = (body) => post('/api/plan/preview', { ...body, groupId: idAktif() });
export const createPlan = (body) => post('/api/plan', { ...body, groupId: idAktif() });
export const listPlans = () => get(url('/api/plan'));
export const getPlan = (id) => get(`/api/plan/${id}`);
export const deletePlan = (id) => del(`/api/plan/${id}`);
/** `platforms` opsional: kalau diisi, hanya platform itu yang ditulis ulang. */
export const planCaption = (planId, videoId, brief, platforms) =>
  post(`/api/plan/${planId}/caption/${videoId}`, { brief, platforms });
/** `sekarang: true` memakai mode shareNow Buffer, bukan jadwal item ini. */
export const sendPlanItem = (planId, index, sekarang = false) =>
  post(`/api/plan/${planId}/send/${index}`, { sekarang });
export const planItemText = (planId, index) => get(`/api/plan/${planId}/text/${index}`);
export const updatePlanItem = (planId, index, body) => patch(`/api/plan/${planId}/item/${index}`, body);
export const reschedulePlan = (planId, startDate) => post(`/api/plan/${planId}/reschedule`, { startDate });
export const syncPlan = (planId) => post(`/api/plan/${planId}/sync`);

// ---------- tautan ----------
export const listLinks = () => get(url('/api/links'));
export const createLink = (body) => post('/api/links', body);
export const updateLink = (id, body) => patch(`/api/links/${id}`, body);
export const deleteLink = (id) => del(`/api/links/${id}`);

// ---------- pengaturan ----------
export const getSettings = (refresh) => get(`/api/settings${refresh ? '?refresh=1' : ''}`);
export const getOrphanChannels = (refresh) => get(`/api/channels/yatim${refresh ? '?refresh=1' : ''}`);
export const migrateChannel = (dari, ke) => post('/api/channels/pindah', { dari, ke });
export const saveSettings = (body) => patch('/api/settings', body);

// ---------- diagnosa AI ----------
export const testAI = () => get('/api/ai/test');
export const getDiagnostics = (refresh) => get(`/api/diagnostics${refresh ? '?refresh=1' : ''}`);
export const checkMedia = (id) => get(`/api/media/check${id ? `?id=${id}` : ''}`);

// ---------- sesi ----------
export const authStatus = () => get('/api/auth/status');
export const logout = () => post('/api/auth/logout');
export const changePassword = (body) => post('/api/auth/password', body);

// ---------- riwayat & insight ----------
export const getHistory = (limit = 100) => get(`/api/history?limit=${limit}`);
export const getInsights = (refresh) => get(url('/api/insights', { refresh }));
export const getMetricSchema = (refresh) => get(`/api/insights/skema${refresh ? '?refresh=1' : ''}`);

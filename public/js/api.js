/** Pembungkus tipis semua endpoint server. Semua error dilempar sebagai Error biasa. */

async function parse(res) {
  let data = null;
  try {
    data = await res.json();
  } catch {
    // biarkan null
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

// ---------- upload ----------
/** /api/upload menerima satu file per request, jadi batch = beberapa request. */
export function uploadVideo(file, onProgress) {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    fd.append('video', file);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload');
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
      if (xhr.status >= 200 && xhr.status < 300 && data?.url) resolve(data);
      else reject(new Error(data?.error || `Upload gagal (HTTP ${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error('Koneksi terputus saat upload'));
    xhr.send(fd);
  });
}

// ---------- video ----------
export const listVideos = (status) => get(`/api/videos${status ? `?status=${status}` : ''}`);
export const updateVideo = (id, patchBody) => patch(`/api/videos/${id}`, patchBody);
export const deleteVideo = (id) => del(`/api/videos/${id}`);
export const reorderVideos = (ids) => post('/api/videos/reorder', { ids });
export const suggestTitle = (id, brief, count) => post(`/api/videos/${id}/suggest-title`, { brief, count });

// ---------- channel & kuota ----------
export const getChannels = () => get('/api/channels');
export const getChannelsDetail = (refresh) => get(`/api/channels/detail${refresh ? '?refresh=1' : ''}`);
export const getQueue = () => get('/api/queue');
export const getChannelBoards = (id, refresh) => get(`/api/channels/${id}/boards${refresh ? '?refresh=1' : ''}`);
export const setChannelSettings = (id, body) => patch(`/api/channels/${id}/settings`, body);
export const getUsage = () => get('/api/usage');
export const getHealth = () => get('/api/health');

// ---------- hashtag ----------
export const listHashtags = () => get('/api/hashtags');
export const createHashtagSet = (body) => post('/api/hashtags', body);
export const updateHashtagSet = (id, body) => patch(`/api/hashtags/${id}`, body);
export const deleteHashtagSet = (id) => del(`/api/hashtags/${id}`);
export const suggestHashtags = (brief, platform, count) => post('/api/hashtags/suggest', { brief, platform, count });

// ---------- jadwal ----------
export const previewPlan = (body) => post('/api/plan/preview', body);
export const createPlan = (body) => post('/api/plan', body);
export const listPlans = () => get('/api/plan');
export const getPlan = (id) => get(`/api/plan/${id}`);
export const deletePlan = (id) => del(`/api/plan/${id}`);
/** `platforms` opsional: kalau diisi, hanya platform itu yang ditulis ulang. */
export const planCaption = (planId, videoId, brief, platforms) =>
  post(`/api/plan/${planId}/caption/${videoId}`, { brief, platforms });
export const sendPlanItem = (planId, index) => post(`/api/plan/${planId}/send/${index}`);
export const planItemText = (planId, index) => get(`/api/plan/${planId}/text/${index}`);
export const updatePlanItem = (planId, index, body) => patch(`/api/plan/${planId}/item/${index}`, body);
export const reschedulePlan = (planId, startDate) => post(`/api/plan/${planId}/reschedule`, { startDate });

// ---------- tautan ----------
export const listLinks = () => get('/api/links');
export const createLink = (body) => post('/api/links', body);
export const updateLink = (id, body) => patch(`/api/links/${id}`, body);
export const deleteLink = (id) => del(`/api/links/${id}`);

// ---------- diagnosa AI ----------
export const testAI = () => get('/api/ai/test');
export const getDiagnostics = (refresh) => get(`/api/diagnostics${refresh ? '?refresh=1' : ''}`);
export const checkMedia = (id) => get(`/api/media/check${id ? `?id=${id}` : ''}`);

// ---------- riwayat & insight ----------
export const getHistory = (limit = 100) => get(`/api/history?limit=${limit}`);
export const getInsights = (refresh) => get(`/api/insights${refresh ? '?refresh=1' : ''}`);

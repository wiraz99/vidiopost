// Pembungkus tipis untuk semua endpoint server.
// Endpoint lama (/api/upload, /api/channels, /api/caption, /api/publish) dipakai apa adanya.

async function json(res) {
  let data = null;
  try {
    data = await res.json();
  } catch {
    // biarkan null
  }
  if (!res.ok) {
    throw new Error(data?.error || data?.detail || `HTTP ${res.status}`);
  }
  return data;
}

const post = (url, body) =>
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }).then(json);

export const getChannels = () => fetch('/api/channels').then(json);

// /api/upload menerima satu file per request (upload.single('video')),
// jadi batch = beberapa request. onProgress dipanggil 0..1.
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
    xhr.onabort = () => reject(new Error('Upload dibatalkan'));
    xhr.send(fd);
  });
}

export const generateCaptions = (brief, platforms) => post('/api/caption', { brief, platforms });

export const publish = (videoUrl, captionsByChannelId, channelIds) =>
  post('/api/publish', { videoUrl, captionsByChannelId, channelIds });

// --- endpoint baru ---
export const getQueue = () => fetch('/api/queue').then(json);
export const setQueue = (channelId, pending) => post('/api/queue', { channelId, pending });
export const getHistory = (limit = 100) => fetch(`/api/history?limit=${limit}`).then(json);
export const addHistory = (payload) => post('/api/history', payload);
export const patchHistoryResult = (id, channelId, ok, error) =>
  post(`/api/history/${id}/result`, { channelId, ok, error });

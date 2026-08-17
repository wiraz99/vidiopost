/**
 * Insight performa konten.
 *
 * Halaman ini sengaja jujur soal ketidakpastian: ketersediaan metrics di paket
 * Buffer Free belum terbukti. Kalau Buffer tidak mengembalikan angka, yang
 * ditampilkan adalah penjelasan kenapa — bukan grafik kosong.
 */
import * as api from '../api.js';
import { el, html, toast, busy, formatDate, formatNumber, platformDot, escapeHtml, iconSvg, button } from '../utils.js';

export async function render(view) {
  const wrap = el('div', 'stack');
  wrap.append(el('p', 'empty', 'Memuat insight…'));
  view.append(wrap);

  await load(view, false);
}

async function load(view, refresh) {
  let data;
  try {
    data = await api.getInsights(refresh);
  } catch (err) {
    view.innerHTML = '';
    view.append(el('div', 'alert alert-bad', `Gagal memuat insight: ${err.message}`));
    return;
  }

  view.innerHTML = '';
  const page = el('div', 'stack');

  if (!data.available) {
    page.append(buildUnavailable(data, view));
    view.append(page);
    return;
  }

  // ---------- ringkasan ----------
  const total = data.posts.reduce((sum, p) => sum + (p.primary?.value || 0), 0);
  const best = data.posts[0];

  page.append(html('section', 'panel', `
    <div class="row-between" style="margin-bottom:10px">
      <div class="panel-title" style="margin:0">Ringkasan</div>
      <button class="btn btn-ghost btn-sm" id="refreshBtn">${iconSvg('refresh', 14)} Ambil data terbaru</button>
    </div>
    <div class="stat-grid">
      <div class="stat">
        <div class="stat-label">Total ${escapeHtml(data.metricName)}</div>
        <div class="stat-value">${formatNumber(total)}</div>
      </div>
      <div class="stat">
        <div class="stat-label">Post terukur</div>
        <div class="stat-value">${data.posts.length}</div>
      </div>
      <div class="stat">
        <div class="stat-label">Rata-rata per post</div>
        <div class="stat-value">${formatNumber(Math.round(total / data.posts.length))}</div>
      </div>
    </div>
    <p class="muted" style="margin-top:10px">
      Data diambil ${escapeHtml(formatDate(data.fetchedAt))} · disegarkan otomatis tiap ${data.ttlHours} jam
      (kuota API Buffer terbatas, jadi tidak diambil ulang tiap buka halaman).
    </p>
  `));

  page.querySelector('#refreshBtn').onclick = async (e) => {
    const done = busy(e.target, 'Mengambil…');
    try {
      await load(view, true);
      toast('Data disegarkan.', 'ok');
    } finally {
      done();
    }
  };

  // ---------- perbandingan platform ----------
  if (data.byPlatform?.length) {
    const panel = html('section', 'panel', `
      <div class="panel-title">Perbandingan antar platform</div>
      <p class="hint">Total ${escapeHtml(data.metricName)} dari semua post di tiap platform.</p>
      <div id="platformBars"></div>
    `);
    panel.querySelector('#platformBars').append(buildBars(data.byPlatform, (row) => row.key));
    page.append(panel);
  }

  // ---------- performa hashtag ----------
  const panel = html('section', 'panel', `
    <div class="panel-title">Performa set hashtag</div>
    <div id="hashtagBars"></div>
  `);
  const hashtagBox = panel.querySelector('#hashtagBars');
  if (data.byHashtagSet?.length) {
    hashtagBox.append(el('p', 'hint', `Rata-rata ${data.metricName} per post untuk tiap set hashtag.`));
    hashtagBox.append(buildBars(data.byHashtagSet, (row) => row.name || row.key, 'average'));
  } else {
    hashtagBox.append(el('p', 'empty',
      'Belum ada data. Angka ini baru muncul setelah beberapa jadwal terkirim dengan set hashtag yang berbeda-beda.'));
  }
  page.append(panel);

  // ---------- performa per konten ----------
  const contentPanel = html('section', 'panel', `
    <div class="panel-title">Performa per konten</div>
    <div class="vlist" id="postList"></div>
  `);
  const postList = contentPanel.querySelector('#postList');
  for (const post of data.posts) {
    const row = el('div', 'vrow');
    row.style.gridTemplateColumns = 'auto 1fr auto';
    row.append(platformDot(post.platform));

    const body = el('div', 'vbody');
    body.append(el('div', 'vtitle truncate', post.title));
    const meta = el('div', 'vmeta');
    meta.append(el('span', null, post.channelLabel));
    if (post.dueAt) meta.append(el('span', null, formatDate(post.dueAt, false)));
    body.append(meta);
    row.append(body);

    const value = el('div');
    value.style.textAlign = 'right';
    value.append(el('div', null, formatNumber(post.primary?.value)));
    value.append(el('div', 'muted', post.primary?.name || ''));
    row.append(value);

    postList.append(row);
  }
  page.append(contentPanel);

  view.append(page);
}

/** Diagram batang horizontal sederhana — cukup untuk membandingkan besaran. */
function buildBars(rows, labelFn, field = 'total') {
  const box = el('div');
  const max = Math.max(...rows.map((r) => r[field]), 1);

  for (const row of rows) {
    const line = el('div', 'bar-row');
    line.append(el('span', 'truncate', labelFn(row)));

    const track = el('div', 'bar-track');
    const fill = el('div', 'bar-fill');
    fill.style.width = `${Math.max(2, (row[field] / max) * 100)}%`;
    track.append(fill);
    line.append(track);

    line.append(el('span', null, formatNumber(row[field])));
    box.append(line);
  }
  return box;
}

function buildUnavailable(data, view) {
  const box = el('div', 'stack');

  box.append(html('div', 'alert alert-warn', `
    <b>Insight belum bisa ditampilkan</b>
    <div style="margin-top:6px">${escapeHtml(data.reason || 'Alasan tidak diketahui.')}</div>
  `));

  if (data.needsToken) {
    box.append(html('section', 'panel', `
      <div class="panel-title">Yang perlu dilakukan</div>
      <ol style="margin:0;padding-left:20px;font-size:14px;line-height:1.9">
        <li>Buka Buffer → <b>Settings → API</b>, buat API key</li>
        <li>Isi <code>BUFFER_TOKEN_A</code> dan <code>BUFFER_TOKEN_B</code> di file <code>.env</code></li>
        <li>Jalankan ulang server</li>
      </ol>
    `));
  } else {
    box.append(html('section', 'panel', `
      <div class="panel-title">Kenapa ini bisa terjadi</div>
      <p style="font-size:14px">
        Analytics di aplikasi Buffer adalah fitur berbayar. Dokumentasi API-nya menyediakan
        field metrics dan tidak menyebut batasan paket, tapi itu belum tentu berlaku untuk akun gratis.
      </p>
      <p style="font-size:14px">
        Untuk memastikan, jalankan probe berikut di server lalu lihat bagian <b>METRICS</b>:
      </p>
      <pre style="background:var(--surface-2);padding:11px;border-radius:9px;overflow-x:auto;font-size:12.5px"><code>node scripts/probe-buffer.js</code></pre>
      <p class="muted">
        Kalau hasilnya metrics kosong, insight otomatis dari Buffer memang tidak tersedia
        di paket ini dan perlu pendekatan lain.
      </p>
    `));
  }

  const retry = button('btn btn-ghost', 'refresh', 'Coba ambil lagi');
  retry.onclick = async (e) => {
    const done = busy(e.target, 'Mengambil…');
    try {
      await load(view, true);
    } finally {
      done();
    }
  };
  box.append(retry);

  if (data.usage) {
    box.append(el('p', 'muted',
      `Kuota API Buffer hari ini: ${data.usage.dayCount}/${data.usage.dayLimit} request.`));
  }

  return box;
}

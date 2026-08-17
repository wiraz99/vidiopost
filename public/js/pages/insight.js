/**
 * Insight performa konten.
 *
 * Prinsip tampilannya satu: JANGAN MENYATUKAN ANGKA YANG BUKAN SEJENIS.
 *
 * Tiap jaringan melaporkan metrik yang berbeda, dan sebagian belum melaporkan
 * apa pun. Jadi tidak ada satu angka besar "total performa" di halaman ini —
 * yang ada adalah perbandingan di dalam platform yang sama, perbandingan satu
 * video antar platform (ini yang cocok dengan pola rotasi), dan penjelasan
 * terbuka soal channel mana yang datanya memang belum ada.
 */
import * as api from '../api.js';
import {
  el, html, toast, busy, formatDate, formatNumber, platformDot,
  escapeHtml, icon, button, setPageTitle
} from '../utils.js';
import { metaFor } from '../config.js';

let data = null;
let sortKey = null;
let platformFilter = 'semua';
let view = null;

export async function render(container) {
  view = container;
  setPageTitle('Insight');
  view.append(el('p', 'empty', 'Memuat insight…'));
  await load(false);
}

async function load(refresh) {
  try {
    data = await api.getInsights(refresh);
  } catch (err) {
    view.innerHTML = '';
    view.append(el('div', 'alert alert-bad', `Gagal memuat insight: ${err.message}`));
    return;
  }
  sortKey = data.metrics?.[0]?.key || null;
  platformFilter = 'semua';
  paint();
}

function paint() {
  view.innerHTML = '';
  const page = el('div', 'stack');

  page.append(headerPanel());

  if (!data.available) {
    page.append(belumAda());
    view.append(page);
    return;
  }

  for (const teks of data.catatan || []) {
    page.append(html('div', 'alert alert-warn', escapeHtml(teks)));
  }
  if (data.refreshError) {
    page.append(html('div', 'alert alert-bad',
      `Gagal menyegarkan, yang tampil adalah data lama: ${escapeHtml(data.refreshError)}`));
  }

  page.append(diagnosaPanel());

  if (!data.punyaAngka) {
    page.append(html('section', 'panel', `
      <div class="panel-title">Belum ada angka yang bisa ditampilkan</div>
      <p style="font-size:14px;line-height:1.7">
        Ada <b>${data.ringkas.totalPost} post</b> berstatus terkirim, tapi Buffer belum
        mengembalikan satu metrik pun. Tabel di atas menunjukkan channel mana saja yang sudah
        dan belum melaporkan.
      </p>
      <p class="muted">
        Buffer menarik metrik dari tiap jaringan sekali sehari, dan post baru butuh sampai
        24 jam sebelum angkanya muncul. Query metrik juga masih ditandai
        <i>experimental</i> oleh Buffer, jadi cakupannya bisa berubah sewaktu-waktu.
      </p>
    `));
    view.append(page);
    return;
  }

  page.append(platformPanel());
  page.append(videoPanel());
  page.append(postPanel());
  page.append(hashtagPanel());

  view.append(page);
}

// ---------- kepala ----------

function headerPanel() {
  const panel = el('section', 'panel');

  const head = el('div', 'page-head');
  const kiri = el('div');
  kiri.append(el('h2', 'page-title', 'Performa konten'));
  kiri.append(el('p', 'page-sub', data.available
    ? `${data.ringkas.totalPost} post terkirim · ${data.ringkas.berangka} sudah punya angka`
    : 'Data dari Buffer'));
  head.append(kiri);

  const refresh = button('btn btn-ghost btn-sm', 'refresh', 'Ambil data terbaru');
  refresh.onclick = async (e) => {
    const done = busy(e.currentTarget, 'Mengambil…');
    try {
      await load(true);
      toast('Data disegarkan.', 'ok');
    } catch {
      done();
    }
  };
  head.append(refresh);
  panel.append(head);

  if (data.fetchedAt) {
    const baris = [`Diambil dari Buffer ${formatDate(data.fetchedAt)}`];
    if (data.ringkas?.terakhirDiperbarui) {
      baris.push(`Buffer terakhir menyegarkan metrik ${formatDate(data.ringkas.terakhirDiperbarui)}`);
    }
    if (data.ttlHours) baris.push(`disegarkan otomatis tiap ${data.ttlHours} jam`);
    panel.append(el('p', 'note', `${baris.join(' · ')}.`));
  }

  return panel;
}

// ---------- diagnosa per channel ----------

/**
 * Tabel ini yang menjawab pertanyaan "kok platform X tidak muncul".
 * Channel yang belum melaporkan apa pun tetap ditampilkan — kalau disembunyikan,
 * ketiadaannya jadi misteri, bukan informasi.
 */
function diagnosaPanel() {
  const panel = html('section', 'panel', `
    <div class="row-between">
      <div class="panel-title" style="margin:0">Apa yang dilaporkan tiap channel</div>
      <button class="btn btn-ghost btn-sm" id="toggleDiag">${data.punyaAngka ? 'Tampilkan' : 'Sembunyikan'}</button>
    </div>
  `);

  const box = el('div');
  box.style.marginTop = 'var(--s4)';
  box.hidden = !!data.punyaAngka;

  const rows = data.diagnosa || [];
  if (!rows.length) {
    box.append(el('p', 'empty', 'Belum ada channel yang terbaca.'));
  }

  for (const d of rows) {
    const row = el('div', 'diagrow');
    row.append(platformDot(d.platform));

    const body = el('div', 'grow');
    const judul = el('div', 'diagrow-label');
    judul.append(el('span', null, d.label));
    if (d.takDikenal) {
      const tag = el('span', 'badge', 'tidak ada di daftar channel');
      tag.title = 'Post ini ada di Buffer tapi channelnya tidak terbaca lagi';
      judul.append(tag);
    }
    body.append(judul);

    const detail = el('div', 'diagrow-detail');
    if (!d.sentCount) {
      detail.textContent = 'belum ada post terkirim';
    } else if (!d.withMetrics) {
      detail.append(el('span', 'bad-text', `${d.sentCount} post terkirim · belum ada metrik`));
    } else {
      detail.append(el('span', null,
        `${d.withMetrics} dari ${d.sentCount} post punya metrik · ${d.metrics.join(', ')}`));
      if (d.lastUpdate) detail.append(el('span', 'muted', ` · diperbarui ${formatDate(d.lastUpdate)}`));
    }
    body.append(detail);
    row.append(body);

    // Hasil pemeriksaan jalur kedua, khusus channel yang metrik per-postnya kosong.
    if (!d.withMetrics && d.agregat) {
      const a = d.agregat;
      const ag = el('div', 'diagrow-detail');
      if (a.error) {
        ag.append(el('span', 'bad-text', `Agregat gagal: ${a.error}`));
      } else if (a.adaAngka) {
        ag.append(el('span', null,
          `Agregat Buffer: ${a.metrics.map((m) => `${m.label} ${formatNumber(m.value)}`).join(' · ')}`));
      } else {
        ag.append(el('span', null,
          `Agregat Buffer: ${a.postCount ?? 0} post, semua angkanya nol`));
      }
      body.append(ag);
    }

    // Balasan mentah — supaya "sebenarnya Buffer bilang apa" tidak perlu terminal.
    if (d.mentah) {
      const lihat = el('button', 'linkbtn');
      lihat.type = 'button';
      lihat.textContent = 'lihat balasan mentah Buffer';
      const pre = el('pre', 'finaltext');
      pre.hidden = true;
      pre.textContent = JSON.stringify(d.mentah, null, 2);
      lihat.onclick = () => {
        pre.hidden = !pre.hidden;
        lihat.textContent = pre.hidden ? 'lihat balasan mentah Buffer' : 'tutup balasan mentah';
      };
      body.append(lihat, pre);
    }

    const status = d.withMetrics
      ? el('span', 'badge badge-sent', 'ada data')
      : el('span', `badge badge-${d.sentCount ? 'error' : 'draft'}`, d.sentCount ? 'kosong' : 'belum ada post');
    row.append(status);

    box.append(row);
  }

  box.append(pemeriksaSkema());

  panel.append(box);
  const toggle = panel.querySelector('#toggleDiag');
  toggle.onclick = () => {
    box.hidden = !box.hidden;
    toggle.textContent = box.hidden ? 'Tampilkan' : 'Sembunyikan';
  };

  return panel;
}

/**
 * Menanyakan langsung ke Buffer metrik apa saja yang dikenal API-nya, lalu
 * membandingkannya dengan apa yang benar-benar kita terima per platform.
 *
 * Gunanya memisahkan dua kemungkinan yang selama ini tercampur:
 *   - API-nya tidak punya metrik itu sama sekali  → tidak ada yang bisa diperbuat
 *   - API punya, tapi platform itu tidak melaporkan → batasan jaringannya
 */
function pemeriksaSkema() {
  const wrap = el('div', 'subcard');
  wrap.style.marginTop = 'var(--s4)';

  const head = el('div', 'row-between');
  head.append(el('div', null, 'Kemampuan API Buffer'));
  const tombol = button('btn btn-ghost btn-sm', 'sparkles', 'Periksa');
  head.append(tombol);
  wrap.append(head);

  const hasil = el('div');
  hasil.style.marginTop = 'var(--s3)';
  hasil.append(el('p', 'note',
    'Menanyakan ke Buffer daftar metrik yang dikenal API-nya, lalu membandingkannya dengan ' +
    'yang benar-benar diterima tiap platform. Memakai satu request kuota.'));
  wrap.append(hasil);

  const gambar = (d) => {
    hasil.innerHTML = '';

    if (!d.ada) {
      hasil.append(el('p', 'mempty bad-text', d.alasan || 'Tidak bisa diperiksa.'));
      return;
    }

    hasil.append(el('p', 'note',
      `Diperiksa ${formatDate(d.skema.diperiksaPada)} · API mengenal ${d.dikenal.length} jenis metrik.`));

    const platforms = Object.keys(d.diterima).sort();
    if (!platforms.length) {
      hasil.append(el('p', 'mempty', 'Belum ada metrik yang pernah diterima dari platform mana pun.'));
    }

    for (const p of platforms) {
      const baris = el('div', 'vidrow');
      baris.append(platformDot(p));
      baris.append(el('span', 'vidrow-name truncate', metaFor(p).name));

      const chips = el('span', 'chipset');
      const daftar = d.diterima[p];
      if (daftar.length) {
        for (const k of daftar) {
          const chip = el('span', 'mchip');
          chip.append(el('span', 'mchip-label', k));
          chips.append(chip);
        }
      } else {
        chips.append(el('span', 'bad-text', 'tidak pernah mengirim metrik apa pun'));
      }
      baris.append(chips);
      hasil.append(baris);
    }

    // Inilah kesimpulan yang selama ini sulit ditarik.
    const kosong = platforms.filter((p) => !d.diterima[p].length);
    if (kosong.length) {
      hasil.append(html('div', 'alert alert-info', `
        <div>
          <b>Kesimpulan untuk ${kosong.map((p) => escapeHtml(metaFor(p).name)).join(', ')}</b>
          <div style="margin-top:5px">
            API Buffer mengenal ${d.dikenal.length} jenis metrik dan platform lain berhasil
            mengirimkannya lewat query yang sama persis. Jadi kekosongan di sini bukan karena
            query yang salah atau field yang belum diminta — jaringan itu memang tidak
            melaporkan apa pun ke API Buffer.
          </div>
          <div style="margin-top:5px">
            Angka yang muncul di halaman Buffer datang dari jalur internal mereka, yang
            menurut dokumentasi Buffer sendiri berbeda dari API publik ini.
          </div>
        </div>
      `));
    }

    if (d.belumPernahDiterima?.length) {
      hasil.append(el('p', 'note',
        `Dikenal API tapi belum pernah kita terima dari mana pun: ${d.belumPernahDiterima.join(', ')}.`));
    }
  };

  tombol.onclick = async (e) => {
    const done = busy(e.currentTarget, 'Menanya…');
    try {
      gambar(await api.getMetricSchema(true));
    } catch (err) {
      hasil.innerHTML = '';
      hasil.append(el('p', 'mempty bad-text', `Gagal memeriksa: ${err.message}`));
    } finally {
      done();
    }
  };

  // Kalau sudah pernah diperiksa, tampilkan hasil tersimpan tanpa memakai kuota.
  api.getMetricSchema(false).then((d) => { if (d.ada) gambar(d); }).catch(() => {});

  return wrap;
}

// ---------- per platform ----------

function platformPanel() {
  const panel = html('section', 'panel', `
    <div class="panel-title">Per platform</div>
    <p class="hint">
      Angka antar platform sengaja tidak dijumlahkan — tiap jaringan melaporkan hal yang
      berbeda, jadi menyatukannya cuma bikin kesimpulan yang salah.
    </p>
    <div class="metric-grid" id="platformGrid"></div>
  `);

  const grid = panel.querySelector('#platformGrid');
  for (const p of data.byPlatform) {
    const card = el('div', 'mcard');

    const head = el('div', 'mcard-head');
    head.append(platformDot(p.platform));
    head.append(el('span', 'grow', metaFor(p.platform).name));
    head.append(el('span', 'muted', `${p.postCount} post`));
    card.append(head);

    if (p.metrics.length) {
      for (const m of p.metrics) card.append(metricRow(m));
      if (p.withMetrics < p.postCount) {
        card.append(el('p', 'note', `${p.postCount - p.withMetrics} post belum punya angka.`));
      }
    } else if (p.agregat?.adaAngka) {
      // Metrik per-post kosong, tapi ringkasan agregat Buffer punya angkanya.
      for (const m of p.agregat.metrics) {
        card.append(metricRow({ label: m.label, total: m.value, average: m.value, percent: false }));
      }
      card.append(el('p', 'note', 'Dari ringkasan agregat Buffer — platform ini tidak melaporkan angka per post.'));
    } else if (p.agregat?.postCount) {
      card.append(el('p', 'mempty',
        `Buffer melihat ${p.agregat.postCount} post di platform ini, tapi semua angkanya nol. ` +
        'Jaringannya memang tidak melaporkan reaksi/komentar ke Buffer.'));
    } else if (p.agregat?.error) {
      card.append(el('p', 'mempty bad-text', `Pemeriksaan agregat gagal: ${p.agregat.error}`));
    } else {
      card.append(el('p', 'mempty', 'Belum ada metrik dari Buffer untuk platform ini.'));
    }
    grid.append(card);
  }

  return panel;
}

function metricRow(m) {
  const row = el('div', 'mrow');
  row.append(el('span', 'mlabel', m.label));

  const nilai = el('span', 'mvalue');
  if (m.percent) {
    nilai.append(el('b', null, `${m.average}%`));
    nilai.append(el('span', 'msub', 'rata-rata'));
  } else {
    nilai.append(el('b', null, formatNumber(m.total)));
    nilai.append(el('span', 'msub', `Ø ${formatNumber(m.average)}`));
  }
  row.append(nilai);
  return row;
}

// ---------- per video ----------

/** Satu video tayang di beberapa channel — ini perbandingan yang paling cocok
 *  dengan pola rotasi yang dipakai halaman Jadwal. */
function videoPanel() {
  const panel = html('section', 'panel', `
    <div class="panel-title">Per video</div>
    <p class="hint">Video yang sama tayang di beberapa platform. Ini hasilnya di masing-masing.</p>
    <div class="stack" id="videoBox"></div>
  `);
  const box = panel.querySelector('#videoBox');

  if (!data.byVideo?.length) {
    box.append(html('p', 'empty',
      'Belum ada post yang bisa dihubungkan ke video di stok. Hubungannya terbentuk otomatis ' +
      'untuk post yang dikirim lewat halaman <a href="#/jadwal">Jadwal</a>.'));
    return panel;
  }

  for (const v of data.byVideo) {
    const card = el('div', 'subcard');
    card.append(el('div', 'vtitle', v.title));
    card.append(el('div', 'muted', `tayang di ${v.postCount} channel`));

    for (const p of v.perPlatform) {
      const baris = el('div', 'vidrow');
      baris.append(platformDot(p.platform));
      baris.append(el('span', 'vidrow-name truncate', p.channelLabel));

      const chips = el('span', 'chipset');
      for (const m of p.metrics.slice(0, 4)) {
        const chip = el('span', 'mchip');
        chip.append(el('span', 'mchip-label', m.label));
        chip.append(el('b', null, m.percent ? `${m.average}%` : formatNumber(m.total)));
        chips.append(chip);
      }
      if (!p.metrics.length) chips.append(el('span', 'muted', 'belum ada angka'));
      baris.append(chips);

      card.append(baris);
    }
    box.append(card);
  }

  return panel;
}

// ---------- per post ----------

function postPanel() {
  const panel = html('section', 'panel', `
    <div class="panel-title">Per post</div>
    <div class="filterbar" id="metricChips"></div>
    <div class="filterbar" id="platformChips" style="margin-top:8px"></div>
    <div class="vlist" id="postList" style="margin-top:var(--s4)"></div>
  `);

  const metricChips = panel.querySelector('#metricChips');
  metricChips.append(el('span', 'filterbar-label', 'Urutkan:'));
  for (const m of data.metrics) {
    const chip = el('button', `filterchip${sortKey === m.key ? ' on' : ''}`);
    chip.type = 'button';
    chip.textContent = m.label;
    chip.onclick = () => { sortKey = m.key; paint(); };
    metricChips.append(chip);
  }

  const platforms = ['semua', ...new Set(data.posts.map((p) => p.platform))];
  const platformChips = panel.querySelector('#platformChips');
  platformChips.append(el('span', 'filterbar-label', 'Platform:'));
  for (const p of platforms) {
    const chip = el('button', `filterchip${platformFilter === p ? ' on' : ''}`);
    chip.type = 'button';
    chip.textContent = p === 'semua' ? 'Semua' : metaFor(p).name;
    chip.onclick = () => { platformFilter = p; paint(); };
    platformChips.append(chip);
  }

  const list = panel.querySelector('#postList');
  const nilai = (post) => post.metrics[sortKey]?.value ?? -1;
  const terlihat = data.posts
    .filter((p) => platformFilter === 'semua' || p.platform === platformFilter)
    .sort((a, b) => nilai(b) - nilai(a));

  if (!terlihat.length) list.append(el('p', 'empty', 'Tidak ada post di saringan ini.'));

  for (const post of terlihat) {
    const row = el('div', 'vrow');
    row.style.gridTemplateColumns = 'auto 1fr auto';
    row.append(platformDot(post.platform));

    const body = el('div', 'vbody');
    const judul = el('div', 'vtitle truncate');
    judul.textContent = post.title;
    body.append(judul);

    const meta = el('div', 'vmeta');
    meta.append(el('span', null, post.channelLabel));
    if (post.sentAt) meta.append(el('span', null, formatDate(post.sentAt, false)));
    if (post.externalLink) {
      const a = el('a', null);
      a.href = post.externalLink;
      a.target = '_blank';
      a.rel = 'noopener';
      a.append(icon('link', 12), el('span', null, 'lihat post'));
      meta.append(a);
    }
    body.append(meta);

    const chips = el('div', 'chipset');
    chips.style.marginTop = '5px';
    const urut = Object.values(post.metrics)
      .sort((a, b) => (a.key === sortKey ? -1 : b.key === sortKey ? 1 : 0));
    for (const m of urut.slice(0, 5)) {
      const chip = el('span', `mchip${m.key === sortKey ? ' on' : ''}`);
      chip.append(el('span', 'mchip-label', m.label));
      chip.append(el('b', null, m.percent ? `${m.value}%` : formatNumber(m.value)));
      chips.append(chip);
    }
    if (!post.metricCount) chips.append(el('span', 'muted', 'belum ada metrik'));
    body.append(chips);

    row.append(body);
    list.append(row);
  }

  return panel;
}

// ---------- set hashtag ----------

function hashtagPanel() {
  const panel = html('section', 'panel', `
    <div class="panel-title">Set hashtag</div>
    <p class="hint">
      Dibandingkan pada metrik yang sama. Angkanya baru berarti setelah beberapa jadwal
      terkirim dengan set yang berbeda-beda.
    </p>
    <div id="hashtagBox"></div>
  `);
  const box = panel.querySelector('#hashtagBox');

  if (!data.byHashtagSet?.length) {
    box.append(el('p', 'empty', 'Belum ada post terkirim yang memakai set hashtag.'));
    return panel;
  }

  const rows = data.byHashtagSet
    .map((s) => ({ ...s, metrik: s.metrics.find((m) => m.key === sortKey) }))
    .filter((s) => s.metrik)
    .sort((a, b) => b.metrik.average - a.metrik.average);

  if (!rows.length) {
    box.append(el('p', 'empty', 'Metrik yang dipilih belum ada datanya untuk set mana pun.'));
    return panel;
  }

  const max = Math.max(...rows.map((r) => r.metrik.average), 1);
  box.append(el('p', 'note', `Rata-rata ${rows[0].metrik.label} per post.`));

  for (const r of rows) {
    const line = el('div', 'bar-row');
    line.append(el('span', 'truncate', `${r.name} (${r.postCount})`));
    const track = el('div', 'bar-track');
    const fill = el('div', 'bar-fill');
    fill.style.width = `${Math.max(2, (r.metrik.average / max) * 100)}%`;
    track.append(fill);
    line.append(track, el('span', 'val', formatNumber(r.metrik.average)));
    box.append(line);
  }

  return panel;
}

// ---------- keadaan kosong ----------

function belumAda() {
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
        <li>Isi <code>BUFFER_TOKEN_A</code> dan <code>BUFFER_TOKEN_B</code>, lalu deploy ulang</li>
      </ol>
    `));
  } else {
    box.append(html('section', 'panel', `
      <div class="panel-title">Kenapa masih kosong</div>
      <ul style="margin:0;padding-left:20px;font-size:14px;line-height:1.8">
        <li>Metrik hanya ada untuk post yang benar-benar sudah <b>tayang</b>, bukan yang masih mengantre.</li>
        <li>Buffer menarik metrik dari tiap jaringan <b>sekali sehari</b>; post baru butuh sampai 24 jam.</li>
        <li>Tidak semua jaringan melaporkan hal yang sama — sebagian cuma memberi reaksi dan komentar.</li>
      </ul>
    `));
  }

  if (data.fetchErrors?.length) {
    box.append(html('div', 'alert alert-bad',
      `<b>Buffer membalas error:</b><ul>${
        data.fetchErrors.map((e) => `<li>${escapeHtml(e)}</li>`).join('')
      }</ul>`));
  }

  const retry = button('btn btn-ghost', 'refresh', 'Coba ambil lagi');
  retry.onclick = async (e) => {
    const done = busy(e.currentTarget, 'Mengambil…');
    try {
      await load(true);
    } catch {
      done();
    }
  };
  box.append(retry);

  if (data.usage) {
    box.append(el('p', 'note',
      `Kuota API Buffer hari ini: ${data.usage.dayCount}/${data.usage.dayLimit} request.`));
  }

  return box;
}

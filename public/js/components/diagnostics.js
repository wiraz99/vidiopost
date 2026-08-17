/**
 * Panel diagnosa — ditaruh di halaman Stok (halaman pertama yang terbuka)
 * supaya masalah setelan langsung kelihatan, bukan baru ketahuan waktu
 * pengiriman gagal 18 kali.
 *
 * Kalau semua beres, tampil sebaris kecil dan tidak mengganggu.
 * Kalau ada masalah, terbuka sendiri lengkap dengan cara memperbaikinya.
 */
import * as api from '../api.js';
import { el, html, icon, iconSvg, button, escapeHtml } from '../utils.js';

const ICON = { ok: 'check', warn: 'alert', bad: 'x' };
const COLOR = { ok: 'var(--ok)', warn: 'var(--warn)', bad: 'var(--bad)' };

export function diagnosticsPanel() {
  const panel = html('section', 'panel', `
    <div class="panel-head">
      <div>
        <div class="panel-title">Kesehatan sistem</div>
        <p class="muted" id="diagSummary">Memeriksa…</p>
      </div>
      <div class="row" id="diagActions"></div>
    </div>
    <div id="diagBody"></div>
  `);

  const summary = panel.querySelector('#diagSummary');
  const body = panel.querySelector('#diagBody');
  const actions = panel.querySelector('#diagActions');

  const toggle = el('button', 'linkbtn', 'Lihat rincian');
  const recheck = button('btn btn-ghost btn-sm', 'refresh', 'Periksa ulang');
  actions.append(toggle, recheck);

  let terbuka = false;
  toggle.onclick = () => {
    terbuka = !terbuka;
    body.hidden = !terbuka;
    toggle.textContent = terbuka ? 'Sembunyikan' : 'Lihat rincian';
  };

  async function run() {
    summary.textContent = 'Memeriksa…';
    body.innerHTML = '';
    recheck.disabled = true;

    let data;
    try {
      data = await api.getDiagnostics();
    } catch (err) {
      summary.textContent = `Gagal memeriksa: ${err.message}`;
      recheck.disabled = false;
      return;
    }
    recheck.disabled = false;

    summary.textContent = data.semuaBeres
      ? 'Semua siap — video, channel, dan AI berfungsi.'
      : `${data.jumlahMasalah} hal perlu dibetulkan sebelum bisa mengirim.`;
    summary.style.color = data.semuaBeres ? 'var(--ok)' : 'var(--bad)';

    // Kalau ada masalah, jangan biarkan tersembunyi.
    terbuka = !data.semuaBeres;
    body.hidden = !terbuka;
    toggle.textContent = terbuka ? 'Sembunyikan' : 'Lihat rincian';

    for (const check of data.checks) {
      const row = el('div', 'diag-row');

      const mark = el('span', 'diag-icon');
      mark.style.color = COLOR[check.status];
      mark.innerHTML = iconSvg(ICON[check.status] || 'info', 16);

      const isi = el('div', 'grow');
      isi.append(el('div', 'diag-label', check.label));
      if (check.detail) isi.append(el('div', 'diag-detail', check.detail));
      if (check.url) {
        const link = el('a', 'linkbtn', 'buka URL ini');
        link.href = check.url;
        link.target = '_blank';
        link.rel = 'noopener';
        isi.append(link);
      }
      if (check.fix) {
        const fix = el('div', 'diag-fix');
        fix.append(icon('arrowRight', 13), el('span', 'grow', check.fix));

        // Nilai yang tinggal disalin ke Coolify — mengetik ulang alamat
        // adalah sumber salah ketik yang sudah terbukti.
        if (check.salin) {
          const salin = el('button', 'linkbtn', 'Salin');
          salin.onclick = async () => {
            try {
              await navigator.clipboard.writeText(check.salin);
              salin.textContent = 'Tersalin';
              setTimeout(() => { salin.textContent = 'Salin'; }, 1500);
            } catch {
              // Sebagian browser HP menolak clipboard tanpa HTTPS; tampilkan
              // teksnya supaya masih bisa disorot manual.
              salin.replaceWith(html('code', null, escapeHtml(check.salin)));
            }
          };
          fix.append(salin);
        }
        isi.append(fix);
      }

      row.append(mark, isi);
      body.append(row);
    }
  }

  recheck.onclick = run;
  run();

  return panel;
}

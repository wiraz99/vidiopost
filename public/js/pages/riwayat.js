/** Riwayat: semua item jadwal yang sudah dikirim, plus riwayat publish lama. */
import * as api from '../api.js';
import { el, html, toast, busy, formatDate, formatDayLabel, platformDot, sleep, icon, iconSvg, button } from '../utils.js';

export async function render(view) {
  const wrap = el('div', 'stack');
  wrap.append(el('p', 'empty', 'Memuat riwayat…'));
  view.append(wrap);

  const [planRes, historyRes] = await Promise.allSettled([api.listPlans(), api.getHistory()]);

  view.innerHTML = '';
  const page = el('div', 'stack');

  // ---------- dari jadwal ----------
  const plans = planRes.status === 'fulfilled' ? planRes.value.plans : [];
  const planPanel = html('section', 'panel', `
    <div class="panel-title">Pengiriman jadwal</div>
    <div id="planList"></div>
  `);
  const planList = planPanel.querySelector('#planList');

  if (!plans.length) {
    planList.append(el('p', 'empty', 'Belum ada jadwal yang dibuat.'));
  } else {
    for (const plan of plans) planList.append(buildPlanRow(plan));
  }
  page.append(planPanel);

  // ---------- publish lama ----------
  const entries = historyRes.status === 'fulfilled' ? historyRes.value.entries : [];
  if (entries.length) {
    const oldPanel = html('section', 'panel', `
      <div class="panel-title">Publish langsung (riwayat lama)</div>
      <div class="stack" id="oldList"></div>
    `);
    const oldList = oldPanel.querySelector('#oldList');
    for (const entry of entries) oldList.append(buildHistoryRow(entry));
    page.append(oldPanel);
  }

  view.append(page);
}

function buildPlanRow(plan) {
  const box = el('div', 'subcard');
  box.style.marginBottom = 'var(--s2)';

  const head = el('div', 'row-between');
  const info = el('div');
  info.append(el('div', null, `Mulai ${formatDayLabel(plan.startDate)}`));
  info.append(el('div', 'muted', `dibuat ${formatDate(plan.createdAt)}`));
  head.append(info);

  const right = el('div', 'row');
  right.append(el('span', `badge badge-${plan.sent === plan.total ? 'sent' : plan.failed ? 'error' : 'draft'}`,
    `${plan.sent}/${plan.total} terkirim`));
  const open = el('a', 'btn btn-ghost btn-sm', 'Buka');
  open.href = `#/jadwal?id=${plan.id}`;
  right.append(open);
  head.append(right);
  box.append(head);

  if (plan.failed) {
    const detail = el('div', 'stack');
    detail.hidden = true;
    detail.style.marginTop = '10px';

    const toggle = el('button', 'linkbtn', `Lihat ${plan.failed} yang gagal`);
    toggle.style.marginTop = '8px';
    toggle.onclick = async () => {
      detail.hidden = !detail.hidden;
      toggle.textContent = detail.hidden ? `Lihat ${plan.failed} yang gagal` : 'Sembunyikan';
      if (!detail.hidden && !detail.childElementCount) await loadFailed(detail, plan.id);
    };
    box.append(toggle, detail);
  }

  return box;
}

async function loadFailed(container, planId) {
  container.append(el('p', 'muted', 'Memuat…'));
  try {
    const { plan } = await api.getPlan(planId);
    container.innerHTML = '';
    const failed = plan.items.filter((i) => i.status === 'error');
    if (!failed.length) {
      container.append(el('p', 'muted', 'Tidak ada yang gagal.'));
      return;
    }
    for (const item of failed) container.append(buildFailedRow(item, plan, container));
  } catch (err) {
    container.innerHTML = '';
    container.append(el('p', 'muted', `Gagal memuat: ${err.message}`));
  }
}

function buildFailedRow(item, plan, container) {
  const row = el('div', 'senditem err');
  row.dataset.index = item.index;
  row.append(html('span', 'state', iconSvg('x', 16)));

  const body = el('div', 'grow');
  body.append(el('div', 'truncate', `${item.channelLabel} — ${item.videoTitle}`));
  body.append(el('div', 'muted', `${formatDayLabel(item.date)} ${item.time}`));
  if (item.error) body.append(el('div', 'err-msg', item.error));
  row.append(body);

  row.append(el('span', 'badge badge-error', 'gagal'));

  const retry = button('btn btn-ghost btn-sm', 'refresh', 'Ulangi');
  retry.onclick = async () => {
    const done = busy(retry, 'Mengirim…');
    try {
      const { item: updated } = await api.sendPlanItem(plan.id, item.index);
      Object.assign(item, updated);
      document.dispatchEvent(new Event('buffer-usage-changed'));
      if (updated.status === 'sent') {
        toast('Berhasil dikirim.', 'ok');
        row.remove();
        if (!container.querySelector('.senditem')) container.append(el('p', 'muted', 'Semua sudah berhasil dikirim.'));
      } else {
        toast(`Masih gagal: ${updated.error}`, 'bad');
        row.replaceWith(buildFailedRow(updated, plan, container));
      }
    } catch (err) {
      toast(`Gagal: ${err.message}`, 'bad');
    } finally {
      done();
      await sleep(200);
    }
  };
  row.append(retry);

  return row;
}

function buildHistoryRow(entry) {
  const okCount = entry.results.filter((r) => r.ok).length;
  const total = entry.results.length;

  const box = el('div', 'subcard');

  const head = el('div', 'row-between');
  head.append(el('div', 'truncate', entry.filename || '(tanpa nama)'));
  head.append(el('span', 'muted', formatDate(entry.createdAt)));
  box.append(head);

  const tags = el('div', 'chips');
  tags.style.marginTop = '8px';
  for (const r of entry.results) {
    const chip = el('span', 'chip');
    chip.append(platformDot(r.platform));
    chip.append(icon(r.ok ? 'check' : 'x', 13), el('span', null, r.label));
    if (!r.ok && r.error) chip.title = r.error;
    tags.append(chip);
  }
  box.append(tags);
  box.append(el('div', 'muted', `${okCount}/${total} channel sukses`));

  return box;
}

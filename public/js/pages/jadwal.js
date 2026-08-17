/**
 * Daftar jadwal.
 *
 * Halaman ini sengaja cuma berisi SATU pekerjaan: melihat jadwal yang sudah ada
 * dan memilih salah satunya. Menyusun jadwal baru pindah ke /jadwal/baru, dan
 * isi satu jadwal pindah ke jadwal-detail.js.
 *
 * Sebelumnya ketiganya menumpuk di satu halaman, jadi arsip jadwal cuma
 * kebagian panel sempit di pojok atas dan tombol "Buka"-nya terlempar ke ujung
 * kanan layar — jauh dari judul yang sedang dibaca.
 */
import * as api from '../api.js';
import { el, html, toast, formatDayLabel, formatRange, icon, iconButton, setPageTitle } from '../utils.js';

export async function render(container, params) {
  const planId = params?.get('id');
  if (planId) {
    const mod = await import('./jadwal-detail.js');
    return mod.render(container, planId);
  }
  return renderList(container);
}

async function renderList(view) {
  setPageTitle('Jadwal');

  const wrap = el('div', 'stack');

  const head = html('div', 'page-head', `
    <div>
      <h2 class="page-title">Jadwal tayang</h2>
      <p class="page-sub">Tiap jadwal menyebar video ke semua channel secara bergiliran.</p>
    </div>
  `);
  const newBtn = el('a', 'btn btn-primary');
  newBtn.href = '#/jadwal/baru';
  newBtn.append(icon('plus', 16), el('span', null, 'Buat jadwal baru'));
  head.append(newBtn);
  wrap.append(head);

  const list = el('div', 'stack');
  list.append(el('p', 'empty', 'Memuat…'));
  wrap.append(list);
  view.append(wrap);

  await paint(list);
}

async function paint(list) {
  let plans;
  try {
    ({ plans } = await api.listPlans());
  } catch (err) {
    list.innerHTML = '';
    list.append(el('div', 'alert alert-bad', `Gagal memuat jadwal: ${err.message}`));
    return;
  }

  list.innerHTML = '';

  if (!plans.length) {
    list.append(html('div', 'panel', `
      <p class="empty">
        Belum ada jadwal.<br>
        Siapkan video di <a href="#/stok">Stok Video</a>, lalu
        <a href="#/jadwal/baru">buat jadwal pertama</a>.
      </p>
    `));
    return;
  }

  for (const plan of plans) list.append(planCard(plan, list));
}

/**
 * Kartu jadwal.
 *
 * Seluruh kartunya yang jadi tautan (lewat .stretch), bukan tombol kecil di
 * ujung kanan — di layar lebar jarak antara judul dan tombolnya bisa hampir
 * selebar layar, dan itu yang bikin halaman ini terasa berat dipakai.
 */
function planCard(plan, list) {
  const selesai = plan.sent === plan.total;
  const card = el('div', `plancard${selesai ? ' done' : ''}`);

  const top = el('div', 'plancard-top');

  const title = el('div', 'plancard-title');
  const link = el('a', 'stretch');
  link.href = `#/jadwal?id=${plan.id}`;
  link.textContent = formatRange(plan.startDate, plan.endDate);
  title.append(link);
  top.append(title);

  const badges = el('div', 'row');
  badges.style.gap = '5px';
  if (selesai) badges.append(el('span', 'badge badge-sent', 'selesai'));
  else if (plan.error) badges.append(el('span', 'badge badge-error', `${plan.error} gagal`));
  else if (plan.kurang) badges.append(el('span', 'badge badge-scheduled', `${plan.kurang} belum lengkap`));
  else badges.append(el('span', 'badge badge-draft', 'siap kirim'));

  const del = iconButton('trash', 'Hapus jadwal ini', 'icon-btn danger above');
  del.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    hapus(plan, list);
  };
  badges.append(del);

  top.append(badges);
  card.append(top);

  card.append(el('div', 'plancard-meta',
    `${plan.total} post · ${plan.videoCount} video · ${plan.channelCount} channel`));

  const track = el('div', 'progress');
  const bar = el('div', 'bar');
  bar.style.width = `${plan.total ? (plan.sent / plan.total) * 100 : 0}%`;
  if (selesai) bar.style.background = 'var(--ok)';
  track.append(bar);
  card.append(track);

  const foot = el('div', 'plancard-foot');
  foot.append(el('span', 'tnum', `${plan.sent}/${plan.total} terkirim`));

  if (plan.berikutnya) {
    const next = el('span', 'plancard-next');
    next.append(icon('clock', 13));
    next.append(el('span', null,
      `${plan.berikutnya.channelLabel} · ${formatDayLabel(plan.berikutnya.date)} ${plan.berikutnya.time}`));
    foot.append(next);
  } else if (!selesai && plan.kedaluwarsa) {
    const late = el('span', 'plancard-next bad');
    late.append(icon('alert', 13));
    late.append(el('span', null, `${plan.kedaluwarsa} item waktunya sudah lewat`));
    foot.append(late);
  }

  card.append(foot);
  return card;
}

async function hapus(plan, list) {
  const peringatan = plan.sent
    ? `Jadwal ini sudah punya ${plan.sent} post terkirim ke Buffer.\n` +
      'Menghapusnya di sini TIDAK membatalkan post yang sudah masuk Buffer.\n\nTetap hapus catatannya?'
    : 'Hapus jadwal ini? Video-videonya dikembalikan ke stok.';

  if (!confirm(peringatan)) return;

  try {
    await api.deletePlan(plan.id);
    toast('Jadwal dihapus.', 'ok');
    await paint(list);
  } catch (err) {
    toast(`Gagal menghapus: ${err.message}`, 'bad');
  }
}

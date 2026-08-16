import { metaFor } from './config.js';
import * as api from './api.js';
import { state, plannedCount, usedCount, emitQueueChange, onQueueChange } from './state.js';
import { el } from './utils.js';

// Ringkasan kuota antrian semua channel di bagian atas halaman.
export function initQueueBar(container) {
  function paint() {
    container.innerHTML = '';
    for (const ch of state.channels) {
      const meta = metaFor(ch.platform);
      const used = usedCount(ch.id);
      const planned = plannedCount(ch.id);
      const limit = state.queue.limit;
      const pct = Math.min(100, (used / limit) * 100);
      const pctPlanned = Math.min(100 - pct, (planned / limit) * 100);

      const box = el('div', `qcard${used >= limit ? ' q-full' : used + planned > limit ? ' q-over' : ''}`);

      const head = el('div', 'qhead');
      const dot = el('span', 'ch-dot', meta.icon);
      dot.style.background = meta.color;
      head.append(dot, el('span', 'qname', ch.label));
      box.append(head);

      box.append(el('div', 'qnum', `${used}/${limit} terpakai`));

      const track = el('div', 'qtrack');
      const fill = el('div', 'qfill');
      fill.style.width = `${pct}%`;
      fill.style.background = meta.color;
      const plan = el('div', 'qplan');
      plan.style.width = `${pctPlanned}%`;
      track.append(fill, plan);
      box.append(track);

      const foot = el('div', 'qfoot');
      foot.append(el('span', 'muted', planned ? `+${planned} direncanakan` : `sisa ${Math.max(0, limit - used)} slot`));
      const sync = el('button', 'linkbtn', 'sinkron');
      sync.title = 'Samakan angka dengan antrian asli di dashboard Buffer';
      sync.onclick = async () => {
        const input = prompt(`Berapa post yang sekarang mengantre di ${ch.label}?`, String(used));
        if (input === null) return;
        const n = Number(input);
        if (!Number.isFinite(n) || n < 0) return alert('Masukkan angka >= 0');
        try {
          const { counts, limit: lim } = await api.setQueue(ch.id, n);
          state.queue = { limit: lim, counts };
          emitQueueChange();
        } catch (err) {
          alert(`Gagal menyimpan: ${err.message}`);
        }
      };
      foot.append(sync);
      box.append(foot);

      container.append(box);
    }
  }

  onQueueChange(paint);
  paint();
}

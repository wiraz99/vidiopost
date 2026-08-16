import { metaFor } from './config.js';
import * as api from './api.js';
import { state } from './state.js';
import { el, formatDate } from './utils.js';

export function initHistory(container, emptyNode) {
  async function reload() {
    try {
      const { entries = [] } = await api.getHistory();
      state.history = entries;
    } catch {
      state.history = [];
    }
    paint();
  }

  function paint() {
    container.innerHTML = '';
    if (!state.history.length) {
      emptyNode.hidden = false;
      return;
    }
    emptyNode.hidden = true;

    for (const entry of state.history) {
      const okCount = entry.results.filter((r) => r.ok).length;
      const total = entry.results.length;
      const kind = okCount === total ? 'ok' : okCount === 0 ? 'fail' : 'partial';

      const row = el('div', `hist hist-${kind}`);

      const head = el('div', 'hist-head');
      head.append(el('span', 'hist-file', entry.filename || '(tanpa nama)'));
      head.append(el('span', 'hist-date', formatDate(entry.createdAt)));
      row.append(head);

      const tags = el('div', 'hist-tags');
      for (const r of entry.results) {
        const meta = metaFor(r.platform);
        const t = el('span', `htag ${r.ok ? 'htag-ok' : 'htag-fail'}`);
        t.style.borderColor = meta.color;
        t.textContent = `${r.ok ? '✓' : '✕'} ${r.label}`;
        if (!r.ok && r.error) t.title = r.error;
        tags.append(t);
      }
      row.append(tags);

      if (entry.brief) row.append(el('div', 'hist-brief', entry.brief));

      const foot = el('div', 'hist-foot');
      foot.append(el('span', 'muted', `${okCount}/${total} channel sukses`));
      if (entry.videoUrl) {
        const link = el('a', 'linkbtn', 'lihat video');
        link.href = entry.videoUrl;
        link.target = '_blank';
        link.rel = 'noopener';
        foot.append(link);
      }
      row.append(foot);

      container.append(row);
    }
  }

  reload();
  return { reload };
}

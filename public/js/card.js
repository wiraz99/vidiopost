import { HASHTAG_BANK, fieldsFor, limitsFor, metaFor } from './config.js';
import * as api from './api.js';
import { state, fieldsOf, plannedCount, usedCount, emitQueueChange, onQueueChange } from './state.js';
import { appendHashtags, formatBytes, hashtagsFor, stripHashtags, composeText, el } from './utils.js';
import { renderPreview } from './preview.js';

const STATUS_LABEL = {
  pending: 'Menunggu upload',
  uploading: 'Mengupload…',
  ready: 'Draft',
  publishing: 'Mengirim…',
  published: 'Terkirim',
  partial: 'Sebagian gagal',
  failed: 'Gagal'
};

export function createCardEl(card, { onRemove, onHistoryChange }) {
  const root = el('article', 'card');
  root.dataset.status = card.status;

  root.innerHTML = `
    <header class="card-head">
      <video class="thumb" muted playsinline preload="metadata"></video>
      <div class="card-title">
        <div class="fname" title="${card.filename}">${card.filename}</div>
        <div class="fmeta">${formatBytes(card.size)}</div>
      </div>
      <span class="badge"></span>
      <button class="icon-btn js-remove" title="Hapus kartu" aria-label="Hapus kartu">✕</button>
    </header>

    <div class="progress js-progress"><div class="bar"></div></div>
    <p class="card-error js-error" hidden></p>

    <section class="card-sec">
      <label class="lbl" for="brief-${card.id}">Brief untuk Hermes</label>
      <textarea id="brief-${card.id}" class="js-brief" rows="2"
        placeholder="Contoh: video proses bikin Sale Pisang Granola, tonjolkan tekstur renyah"></textarea>
      <div class="row-between">
        <label class="switch">
          <input type="checkbox" class="js-htoggle" checked />
          <span>Sisipkan hashtag brand</span>
        </label>
        <button class="btn btn-ghost js-generate">✨ Generate Caption</button>
      </div>
      <div class="chips js-hashtags"></div>
    </section>

    <section class="card-sec">
      <div class="lbl">Channel tujuan</div>
      <div class="channel-grid js-channels"></div>
    </section>

    <section class="editors js-editors"></section>

    <div class="warn js-warn" hidden></div>

    <footer class="card-foot">
      <button class="btn btn-primary js-publish">🚀 Publish</button>
    </footer>

    <section class="results js-results" hidden></section>
  `;

  const $ = (sel) => root.querySelector(sel);
  const refs = {
    thumb: $('.thumb'),
    badge: $('.badge'),
    progress: $('.js-progress'),
    bar: $('.js-progress .bar'),
    error: $('.js-error'),
    brief: $('.js-brief'),
    htoggle: $('.js-htoggle'),
    hashtags: $('.js-hashtags'),
    generate: $('.js-generate'),
    channels: $('.js-channels'),
    editors: $('.js-editors'),
    warn: $('.js-warn'),
    publish: $('.js-publish'),
    results: $('.js-results')
  };

  refs.thumb.src = card.objectUrl;
  $('.js-remove').onclick = () => onRemove(card);

  // ---------- status ----------
  function paintStatus() {
    root.dataset.status = card.status;
    refs.badge.textContent = STATUS_LABEL[card.status] || card.status;
    refs.badge.className = `badge badge-${card.status}`;
    refs.progress.hidden = card.status !== 'uploading';
    refs.bar.style.width = `${Math.round(card.progress * 100)}%`;
    refs.error.hidden = !card.error;
    refs.error.textContent = card.error || '';

    const busy = card.status === 'uploading' || card.status === 'publishing';
    refs.publish.disabled = busy || !card.url || card.selected.size === 0;
    refs.generate.disabled = busy || card.generating;
    refs.generate.textContent = card.generating ? '⏳ Menulis…' : '✨ Generate Caption';
  }

  // ---------- hashtag ----------
  function paintHashtags() {
    refs.hashtags.innerHTML = '';
    refs.hashtags.hidden = !card.hashtagsOn;
    for (const { tag } of HASHTAG_BANK) {
      const chip = el('label', 'chip');
      const cb = el('input');
      cb.type = 'checkbox';
      cb.checked = card.hashtags.has(tag);
      cb.onchange = () => {
        const before = allTagsInUse();
        if (cb.checked) card.hashtags.add(tag);
        else card.hashtags.delete(tag);
        rewriteHashtags(before);
      };
      chip.append(cb, el('span', null, tag));
      refs.hashtags.append(chip);
    }
  }

  // Semua tag yang sedang tersisip di caption manapun (untuk dilepas saat berubah).
  function allTagsInUse() {
    const platforms = new Set([...card.selected].map((id) => channelPlatform(id)));
    const tags = new Set();
    for (const p of platforms) {
      for (const t of hashtagsFor(p, new Set(HASHTAG_BANK.map((h) => h.tag)))) tags.add(t);
    }
    return [...tags];
  }

  // Lepas semua hashtag lama dari caption, lalu pasang lagi sesuai pilihan terbaru.
  function rewriteHashtags(previousTags) {
    for (const channelId of card.selected) {
      const f = fieldsOf(card, channelId);
      if (!f.caption) continue;
      f.caption = stripHashtags(f.caption, previousTags);
      if (card.hashtagsOn) {
        f.caption = appendHashtags(f.caption, hashtagsFor(channelPlatform(channelId), card.hashtags));
      }
    }
    paintEditors();
  }

  refs.htoggle.onchange = () => {
    const before = allTagsInUse();
    card.hashtagsOn = refs.htoggle.checked;
    paintHashtags();
    rewriteHashtags(before);
  };

  const channelPlatform = (id) => state.channels.find((c) => c.id === id)?.platform || 'default';

  // ---------- pilih channel ----------
  function paintChannels() {
    refs.channels.innerHTML = '';
    for (const ch of state.channels) {
      const meta = metaFor(ch.platform);
      const used = usedCount(ch.id);
      const mine = card.selected.has(ch.id) && !card.results[ch.id]?.ok ? 1 : 0;
      const planned = plannedCount(ch.id, card.id) + mine;
      const over = used + planned > state.queue.limit;

      const item = el('label', `ch${over ? ' ch-over' : ''}`);
      const cb = el('input');
      cb.type = 'checkbox';
      cb.checked = card.selected.has(ch.id);
      cb.onchange = () => {
        if (cb.checked) {
          card.selected.add(ch.id);
          const f = fieldsOf(card, ch.id);
          if (card.hashtagsOn && f.caption) {
            f.caption = appendHashtags(f.caption, hashtagsFor(ch.platform, card.hashtags));
          }
        } else {
          card.selected.delete(ch.id);
        }
        paintEditors();
        paintStatus();
        emitQueueChange();
      };

      const dot = el('span', 'ch-dot', meta.icon);
      dot.style.background = meta.color;
      const body = el('span', 'ch-body');
      body.append(el('span', 'ch-label', ch.label));
      body.append(el('span', 'ch-quota', `${used}/${state.queue.limit} terpakai${planned ? ` · +${planned} rencana` : ''}`));

      item.append(cb, dot, body);
      refs.channels.append(item);
    }
    paintWarnings();
  }

  // ---------- editor per channel ----------
  function paintEditors() {
    refs.editors.innerHTML = '';
    const selected = state.channels.filter((c) => card.selected.has(c.id));
    if (!selected.length) {
      refs.editors.append(el('p', 'muted', 'Pilih minimal satu channel untuk mulai menulis caption.'));
      return;
    }

    for (const ch of selected) {
      const f = fieldsOf(card, ch.id);
      const meta = metaFor(ch.platform);
      const limits = limitsFor(ch.platform);
      const extra = fieldsFor(ch.platform);

      const box = el('div', 'editor');
      box.style.setProperty('--accent', meta.color);

      const head = el('div', 'editor-head');
      const tag = el('span', 'ch-dot', meta.icon);
      tag.style.background = meta.color;
      head.append(tag, el('b', null, ch.label));
      const prevBtn = el('button', 'btn btn-ghost btn-sm', '👁 Preview');
      head.append(prevBtn);
      box.append(head);

      // preview didefinisikan lebih dulu karena dipakai oleh handler field di bawah
      const preview = el('div', 'preview-wrap');
      preview.hidden = true;
      const updatePreview = () => {
        if (!preview.hidden) preview.innerHTML = renderPreview(ch.platform, f);
      };
      prevBtn.onclick = () => {
        preview.hidden = !preview.hidden;
        prevBtn.textContent = preview.hidden ? '👁 Preview' : '🙈 Tutup';
        updatePreview();
      };

      // field tambahan (judul YouTube / judul + link Pinterest)
      for (const [key, cfg] of Object.entries(extra)) {
        const wrap = el('div', 'field');
        wrap.append(el('label', 'lbl-sm', cfg.label));
        const input = el('input', 'js-extra');
        input.type = key === 'link' ? 'url' : 'text';
        input.placeholder = cfg.placeholder;
        input.maxLength = cfg.max;
        input.value = f[key] || '';
        const count = el('span', 'count');
        const sync = () => {
          f[key] = input.value;
          count.textContent = `${input.value.length}/${cfg.max}`;
          updatePreview();
        };
        input.oninput = sync;
        wrap.append(input, count);
        box.append(wrap);
        sync();
      }

      // caption
      const capWrap = el('div', 'field');
      capWrap.append(el('label', 'lbl-sm', 'Caption'));
      const ta = el('textarea');
      ta.rows = 4;
      ta.placeholder = `Caption untuk ${meta.name}…`;
      ta.value = f.caption || '';
      const count = el('span', 'count');
      const syncCap = () => {
        f.caption = ta.value;
        const n = ta.value.length;
        count.textContent = `${n} / ${limits.hard} karakter`;
        count.className = `count${n > limits.hard ? ' count-bad' : n > limits.soft ? ' count-warn' : ''}`;
        updatePreview();
        paintWarnings();
      };
      ta.oninput = syncCap;
      capWrap.append(ta, count);
      box.append(capWrap);
      box.append(preview);

      syncCap();
      refs.editors.append(box);
    }
  }

  // ---------- peringatan kuota & validasi ----------
  function overQuotaChannels() {
    return state.channels.filter((ch) => {
      if (!card.selected.has(ch.id)) return false;
      if (card.results[ch.id]?.ok) return false;
      return usedCount(ch.id) + 1 > state.queue.limit;
    });
  }

  function tooLongChannels() {
    return state.channels.filter((ch) => {
      if (!card.selected.has(ch.id)) return false;
      return (fieldsOf(card, ch.id).caption || '').length > limitsFor(ch.platform).hard;
    });
  }

  function paintWarnings() {
    const msgs = [];
    const over = overQuotaChannels();
    if (over.length) {
      msgs.push(
        `⚠️ Antrian penuh di: ${over.map((c) => c.label).join(', ')} — ` +
        `sudah ${state.queue.limit}/${state.queue.limit}. Publish tetap bisa, tapi Buffer kemungkinan menolak.`
      );
    }
    const long = tooLongChannels();
    if (long.length) {
      msgs.push(`⚠️ Caption melebihi batas karakter di: ${long.map((c) => c.label).join(', ')}.`);
    }
    refs.warn.hidden = !msgs.length;
    refs.warn.innerHTML = msgs.map((m) => `<div>${m}</div>`).join('');
  }

  // ---------- generate caption ----------
  refs.brief.oninput = () => { card.brief = refs.brief.value; };

  refs.generate.onclick = async () => {
    if (!card.selected.size) return alert('Pilih minimal satu channel dulu.');
    if (!refs.brief.value.trim()) return alert('Isi brief dulu supaya Hermes tahu konteks videonya.');

    card.brief = refs.brief.value;
    card.generating = true;
    card.error = null;
    paintStatus();
    try {
      const platforms = [...new Set([...card.selected].map(channelPlatform))];
      const { captions = {} } = await api.generateCaptions(card.brief, platforms);
      let filled = 0;
      for (const channelId of card.selected) {
        const platform = channelPlatform(channelId);
        let text = captions[platform] || '';
        if (!text) continue;
        filled++;
        if (card.hashtagsOn) text = appendHashtags(text, hashtagsFor(platform, card.hashtags));
        fieldsOf(card, channelId).caption = text;
      }
      if (!filled) card.error = 'Hermes tidak mengembalikan caption. Coba perjelas brief-nya.';
      paintEditors();
    } catch (err) {
      card.error = `Gagal generate caption: ${err.message}`;
    } finally {
      card.generating = false;
      paintStatus();
    }
  };

  // ---------- publish ----------
  async function sendToChannels(channelIds) {
    const captionsByChannelId = {};
    for (const id of channelIds) {
      captionsByChannelId[id] = composeText(channelPlatform(id), fieldsOf(card, id));
    }
    const { results = [] } = await api.publish(card.url, captionsByChannelId, channelIds);
    for (const r of results) {
      // Buffer bisa membalas HTTP 200 tapi isinya MutationError, jadi jangan
      // hanya percaya flag `ok` dari server.
      const detail = r.error || errorTextOf(r.result);
      card.results[r.channelId] = {
        ok: !!r.ok && !detail,
        error: r.ok && !detail ? null : (detail || 'Ditolak Buffer')
      };
    }
    // channel yang tidak muncul di response dianggap gagal
    for (const id of channelIds) {
      if (!card.results[id]) card.results[id] = { ok: false, error: 'Tidak ada respons dari server' };
    }
    return results;
  }

  function errorTextOf(result) {
    if (!result) return null;
    if (Array.isArray(result.errors) && result.errors.length) return result.errors[0].message;
    const created = result.data?.createPost;
    if (created?.message) return created.message;
    return null;
  }

  function settleStatus() {
    const ids = [...card.selected];
    const done = ids.filter((id) => card.results[id]?.ok).length;
    card.status = done === ids.length ? 'published' : done === 0 ? 'failed' : 'partial';
  }

  refs.publish.onclick = async () => {
    if (!card.url) return alert('Video ini belum selesai diupload.');
    const ids = [...card.selected].filter((id) => !card.results[id]?.ok);
    if (!ids.length) return alert('Semua channel yang dipilih sudah terkirim.');

    const empty = ids.filter((id) => !composeText(channelPlatform(id), fieldsOf(card, id)).trim());
    if (empty.length) {
      const names = empty.map((id) => state.channels.find((c) => c.id === id)?.label).join(', ');
      return alert(`Caption masih kosong untuk: ${names}`);
    }

    const over = overQuotaChannels();
    if (over.length) {
      const ok = confirm(
        `Antrian sudah penuh (${state.queue.limit}/${state.queue.limit}) di:\n` +
        `${over.map((c) => `• ${c.label}`).join('\n')}\n\n` +
        'Buffer kemungkinan besar menolak post ini. Tetap lanjut publish?'
      );
      if (!ok) return;
    }
    const long = tooLongChannels();
    if (long.length && !confirm(`Caption melebihi batas di ${long.map((c) => c.label).join(', ')}. Tetap lanjut?`)) {
      return;
    }

    card.status = 'publishing';
    card.error = null;
    paintStatus();
    try {
      await sendToChannels(ids);
      settleStatus();
      const { entry, counts, limit } = await api.addHistory({
        filename: card.filename,
        videoUrl: card.url,
        brief: card.brief,
        results: ids.map((id) => ({ channelId: id, ...card.results[id] }))
      });
      card.historyId = entry.id;
      state.queue = { limit, counts };
      onHistoryChange();
      emitQueueChange();
    } catch (err) {
      card.error = `Publish gagal: ${err.message}`;
      card.status = 'failed';
    }
    paintStatus();
    paintResults();
  };

  // ---------- hasil + retry per channel ----------
  function paintResults() {
    const ids = Object.keys(card.results);
    refs.results.hidden = !ids.length;
    refs.results.innerHTML = '';
    if (!ids.length) return;

    refs.results.append(el('div', 'lbl', 'Hasil publish'));
    for (const id of ids) {
      const ch = state.channels.find((c) => c.id === id);
      const r = card.results[id];
      const row = el('div', `res ${r.ok ? 'res-ok' : 'res-fail'}`);
      row.append(el('span', 'res-icon', r.ok ? '✓' : '✕'));

      const body = el('span', 'res-body');
      body.append(el('span', 'res-label', ch?.label || id));
      if (!r.ok) body.append(el('span', 'res-err', r.error || 'Gagal'));
      row.append(body);

      if (!r.ok) {
        const retry = el('button', 'btn btn-ghost btn-sm', r.pending ? '⏳' : '↻ Retry');
        retry.disabled = !!r.pending;
        retry.onclick = () => retryChannel(id);
        row.append(retry);
      }
      refs.results.append(row);
    }
  }

  async function retryChannel(channelId) {
    card.results[channelId].pending = true;
    paintResults();
    try {
      await sendToChannels([channelId]);
      settleStatus();
      if (card.historyId) {
        const r = card.results[channelId];
        const { counts, limit } = await api.patchHistoryResult(card.historyId, channelId, r.ok, r.error);
        state.queue = { limit, counts };
        onHistoryChange();
        emitQueueChange();
      }
    } catch (err) {
      card.results[channelId] = { ok: false, error: err.message };
    } finally {
      delete card.results[channelId].pending;
      paintStatus();
      paintResults();
    }
  }

  // ---------- upload ----------
  async function startUpload() {
    card.status = 'uploading';
    card.error = null;
    paintStatus();
    try {
      const data = await api.uploadVideo(card.file, (p) => {
        card.progress = p;
        refs.bar.style.width = `${Math.round(p * 100)}%`;
      });
      card.url = data.url;
      card.filename = data.filename || card.filename;
      card.status = 'ready';
    } catch (err) {
      card.status = 'failed';
      card.error = err.message;
    }
    paintStatus();
  }

  // indikator kuota ikut ter-update kalau kartu lain publish
  // (kartu yang sudah dihapus dari DOM dilewati)
  onQueueChange(() => { if (root.isConnected) paintChannels(); });

  // init
  for (const ch of state.channels) card.selected.add(ch.id);
  paintHashtags();
  paintChannels();
  paintEditors();
  paintStatus();
  startUpload();

  return { root, refreshChannels: paintChannels };
}

import { BRAND_NAME, metaFor } from './config.js';
import { escapeHtml } from './utils.js';

// Sorot hashtag & mention supaya panjang teks + posisi hashtag gampang dicek mata.
function richText(text) {
  return escapeHtml(text)
    .replace(/(^|\s)(#[\wÀ-ɏ]+)/g, '$1<span class="pv-tag">$2</span>')
    .replace(/(^|\s)(@[\w.]+)/g, '$1<span class="pv-tag">$2</span>')
    .replace(/\n/g, '<br>');
}

const avatar = (platform) => {
  const m = metaFor(platform);
  return `<span class="pv-avatar" style="background:${m.color}">${m.icon}</span>`;
};

const videoBox = (label = 'VIDEO') => `<div class="pv-media">${label}</div>`;

// Setiap platform punya "bentuk" sendiri — sengaja tidak pixel-perfect,
// tujuannya cuma supaya kelihatan seberapa panjang caption terlihat di feed.
const renderers = {
  instagram: ({ caption }) => `
    <div class="pv pv-instagram">
      <div class="pv-head">${avatar('instagram')}<b>${BRAND_NAME.toLowerCase()}</b></div>
      ${videoBox('REELS 9:16')}
      <div class="pv-actions">♥ &nbsp; 💬 &nbsp; ➤</div>
      <div class="pv-body"><b>${BRAND_NAME.toLowerCase()}</b> ${richText(caption)}</div>
    </div>`,

  tiktok: ({ caption }) => `
    <div class="pv pv-tiktok">
      ${videoBox('FULL SCREEN 9:16')}
      <div class="pv-overlay">
        <div class="pv-head">${avatar('tiktok')}<b>@${BRAND_NAME.toLowerCase()}</b></div>
        <div class="pv-body pv-clamp">${richText(caption)}</div>
      </div>
    </div>`,

  youtube: ({ caption, title }) => `
    <div class="pv pv-youtube">
      ${videoBox('THUMBNAIL 16:9')}
      <div class="pv-body">
        <div class="pv-title">${escapeHtml(title) || '<i class="pv-muted">(judul belum diisi)</i>'}</div>
        <div class="pv-head">${avatar('youtube')}<span>${BRAND_NAME} · 1,2 rb x ditonton</span></div>
        <div class="pv-desc">${richText(caption)}</div>
      </div>
    </div>`,

  facebook: ({ caption }) => `
    <div class="pv pv-facebook">
      <div class="pv-head">${avatar('facebook')}<div><b>${BRAND_NAME}</b><div class="pv-muted">Baru saja · 🌐</div></div></div>
      <div class="pv-body">${richText(caption)}</div>
      ${videoBox('VIDEO')}
      <div class="pv-actions pv-fb-actions"><span>👍 Suka</span><span>💬 Komentar</span><span>↗ Bagikan</span></div>
    </div>`,

  threads: ({ caption }) => `
    <div class="pv pv-threads">
      <div class="pv-thread-row">
        ${avatar('threads')}
        <div class="pv-thread-col">
          <div class="pv-head"><b>${BRAND_NAME.toLowerCase()}</b><span class="pv-muted">· 1m</span></div>
          <div class="pv-body">${richText(caption)}</div>
          ${videoBox('VIDEO')}
          <div class="pv-actions">♥ &nbsp; 💬 &nbsp; ⇄ &nbsp; ➤</div>
        </div>
      </div>
    </div>`,

  pinterest: ({ caption, title, link }) => `
    <div class="pv pv-pinterest">
      ${videoBox('PIN 2:3')}
      <div class="pv-body">
        <div class="pv-title">${escapeHtml(title) || '<i class="pv-muted">(judul pin belum diisi)</i>'}</div>
        <div class="pv-desc">${richText(caption)}</div>
        <div class="pv-link">${
          link ? `🔗 ${escapeHtml(link)}` : '<i class="pv-muted">(link tujuan belum diisi)</i>'
        }</div>
        <div class="pv-head">${avatar('pinterest')}<span>${BRAND_NAME}</span></div>
      </div>
    </div>`
};

export function renderPreview(platform, values) {
  const fn = renderers[platform];
  if (fn) return fn(values);
  return `<div class="pv"><div class="pv-body">${richText(values.caption || '')}</div></div>`;
}

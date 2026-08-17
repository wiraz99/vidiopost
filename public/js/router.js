/**
 * Router hash sederhana. Tiap halaman adalah modul yang diimpor saat
 * pertama kali dibuka, dan mengekspor `render(container)`.
 */
import { NAV } from './config.js';
import { el, qsa, icon } from './utils.js';

const routes = {
  '/stok':    () => import('./pages/stok.js'),
  '/jadwal':  () => import('./pages/jadwal.js'),
  '/hashtag': () => import('./pages/hashtag.js'),
  '/insight': () => import('./pages/insight.js'),
  '/riwayat': () => import('./pages/riwayat.js')
};

const DEFAULT_ROUTE = '/stok';

/** '#/jadwal?id=plan_1' → { path: '/jadwal', params: URLSearchParams } */
export function currentRoute() {
  const raw = location.hash.replace(/^#/, '') || DEFAULT_ROUTE;
  const [path, query = ''] = raw.split('?');
  return { path: routes[path] ? path : DEFAULT_ROUTE, params: new URLSearchParams(query) };
}

export const navigate = (path) => { location.hash = path; };

function buildNav(container, isSidebar) {
  container.innerHTML = '';
  for (const item of NAV) {
    const link = el('a');
    link.href = `#${item.path}`;
    link.dataset.path = item.path;
    link.append(icon(item.icon, isSidebar ? 17 : 20));
    link.append(el('span', 'nav-label', item.label));
    container.append(link);
  }
}

function markActive(path) {
  for (const link of qsa('.nav a, .bottomnav a')) {
    link.classList.toggle('active', link.dataset.path === path);
  }
  const item = NAV.find((n) => n.path === path);
  document.getElementById('pageTitle').textContent = item?.label || 'Video Post';
  document.title = `${item?.label || 'Video Post'} — Arachynana`;
}

let lastPath = null;

export function startRouter() {
  buildNav(document.getElementById('sideNav'), true);
  buildNav(document.getElementById('bottomNav'), false);

  const view = document.getElementById('view');

  async function render(force = false) {
    const { path, params } = currentRoute();
    markActive(path);

    // Ganti halaman hanya kalau path-nya memang berubah, supaya perubahan
    // query string tidak memaksa render ulang dari nol.
    if (path === lastPath && !force) return;
    lastPath = path;

    view.innerHTML = '<p class="empty">Memuat…</p>';
    try {
      const mod = await routes[path]();
      view.innerHTML = '';
      await mod.render(view, params);
    } catch (err) {
      view.innerHTML = '';
      const box = el('div', 'alert alert-bad', `Gagal membuka halaman: ${err.message}`);
      view.append(box);
      console.error(err);
    }
  }

  window.addEventListener('hashchange', () => render());
  document.getElementById('reloadBtn').onclick = () => render(true);

  if (!location.hash) location.hash = DEFAULT_ROUTE;
  render(true);

  return { rerender: () => render(true) };
}

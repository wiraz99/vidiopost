/** Kelola set hashtag: buat, edit, hapus, tandai default, minta saran AI. */
import * as api from '../api.js';
import { el, html, toast, busy, escapeHtml } from '../utils.js';
import { PLATFORM_META } from '../config.js';

const PLATFORMS = Object.keys(PLATFORM_META).filter((p) => p !== 'default');

let sets = [];
let listEl = null;

export async function render(view) {
  const wrap = el('div', 'stack');

  wrap.append(html('section', 'panel', `
    <div class="panel-title">Set hashtag</div>
    <p class="hint">
      Set yang ditandai <b>default</b> otomatis terpilih saat membuat jadwal.
      Kalau sebuah set dibatasi ke platform tertentu, hashtag-nya cuma ikut di platform itu.
      Pinterest &amp; YouTube memang tidak diberi hashtag.
    </p>
    <div class="stack" id="setList"></div>
    <button class="btn btn-primary btn-block" id="addSet" style="margin-top:12px">+ Set baru</button>
  `));

  wrap.append(buildSuggestPanel());
  view.append(wrap);

  listEl = wrap.querySelector('#setList');
  wrap.querySelector('#addSet').onclick = onCreate;

  await reload();
}

async function reload() {
  try {
    ({ sets } = await api.listHashtags());
  } catch (err) {
    toast(`Gagal memuat: ${err.message}`, 'bad');
    sets = [];
  }
  paint();
}

function paint() {
  listEl.innerHTML = '';
  if (!sets.length) {
    listEl.append(el('p', 'empty', 'Belum ada set hashtag.'));
    return;
  }
  for (const set of sets) listEl.append(buildSetCard(set));
}

function buildSetCard(set) {
  const card = el('div', 'panel');
  card.style.boxShadow = 'none';
  card.style.background = 'var(--surface-2)';

  // --- baris judul ---
  const head = el('div', 'row-between');
  const nameInput = el('input');
  nameInput.type = 'text';
  nameInput.value = set.name;
  nameInput.style.fontWeight = '700';
  nameInput.style.maxWidth = '260px';

  const actions = el('div', 'row');

  const defaultChip = el('label', `chip${set.isDefault ? ' on' : ''}`);
  const defaultCb = el('input');
  defaultCb.type = 'checkbox';
  defaultCb.checked = !!set.isDefault;
  defaultChip.append(defaultCb, el('span', null, 'default'));

  const delBtn = el('button', 'icon-btn', '🗑');
  delBtn.title = 'Hapus set';
  delBtn.onclick = async () => {
    if (!confirm(`Hapus set "${set.name}"?`)) return;
    try {
      await api.deleteHashtagSet(set.id);
      sets = sets.filter((s) => s.id !== set.id);
      paint();
      toast('Set dihapus.', 'ok');
    } catch (err) {
      toast(`Gagal menghapus: ${err.message}`, 'bad');
    }
  };

  actions.append(defaultChip, delBtn);
  head.append(nameInput, actions);
  card.append(head);

  // --- hashtag ---
  const tagField = el('div', 'field');
  tagField.style.marginTop = '10px';
  tagField.append(el('label', 'lbl', 'Hashtag'));
  const tagArea = el('textarea');
  tagArea.rows = 3;
  tagArea.placeholder = '#ContohSatu #ContohDua — dipisah spasi, koma, atau baris baru';
  tagArea.value = set.tags.join(' ');
  tagField.append(tagArea);
  const tagCount = el('span', 'count', `${set.tags.length} hashtag`);
  tagField.append(tagCount);
  card.append(tagField);

  // --- batasan platform ---
  const platField = el('div', 'field');
  platField.append(el('label', 'lbl', 'Berlaku di platform (kosongkan = semua)'));
  const chips = el('div', 'chips');
  const platformBoxes = [];
  for (const platform of PLATFORMS) {
    const chip = el('label', `chip${set.platforms?.includes(platform) ? ' on' : ''}`);
    const cb = el('input');
    cb.type = 'checkbox';
    cb.checked = !!set.platforms?.includes(platform);
    cb.dataset.platform = platform;
    cb.onchange = () => chip.classList.toggle('on', cb.checked);
    chip.append(cb, el('span', null, PLATFORM_META[platform].name));
    chips.append(chip);
    platformBoxes.push(cb);
  }
  platField.append(chips);
  card.append(platField);

  // --- simpan ---
  const saveBtn = el('button', 'btn btn-ghost btn-sm', 'Simpan perubahan');
  saveBtn.onclick = async () => {
    const done = busy(saveBtn, 'Menyimpan…');
    try {
      const { set: updated } = await api.updateHashtagSet(set.id, {
        name: nameInput.value,
        tags: tagArea.value,
        platforms: platformBoxes.filter((c) => c.checked).map((c) => c.dataset.platform),
        isDefault: defaultCb.checked
      });
      Object.assign(set, updated);
      tagArea.value = updated.tags.join(' ');
      tagCount.textContent = `${updated.tags.length} hashtag`;
      toast('Tersimpan.', 'ok');
    } catch (err) {
      toast(`Gagal menyimpan: ${err.message}`, 'bad');
    } finally {
      done();
    }
  };
  card.append(saveBtn);

  return card;
}

async function onCreate(e) {
  const name = prompt('Nama set baru (mis. Produk, Resep, Promo):');
  if (!name?.trim()) return;

  const done = busy(e.target, 'Membuat…');
  try {
    const { set } = await api.createHashtagSet({ name: name.trim(), tags: [] });
    sets.push(set);
    paint();
    toast('Set dibuat. Tambahkan hashtag-nya.', 'ok');
  } catch (err) {
    toast(`Gagal membuat set: ${err.message}`, 'bad');
  } finally {
    done();
  }
}

// ================= saran AI =================

function buildSuggestPanel() {
  const panel = html('section', 'panel', `
    <div class="panel-title">Minta saran AI</div>
    <p class="hint">Jelaskan isi kontennya, AI usulkan hashtag. Pilih yang cocok, lalu simpan jadi set baru.</p>
    <div class="field">
      <label class="lbl" for="sugBrief">Brief</label>
      <textarea id="sugBrief" rows="2" placeholder="Contoh: video proses bikin sale pisang, tekstur renyah, camilan sore"></textarea>
    </div>
    <div class="field-row cols-2">
      <div class="field">
        <label class="lbl" for="sugPlatform">Platform</label>
        <select id="sugPlatform">
          ${PLATFORMS.map((p) => `<option value="${p}"${p === 'instagram' ? ' selected' : ''}>${PLATFORM_META[p].name}</option>`).join('')}
        </select>
      </div>
      <div class="field">
        <label class="lbl" for="sugCount">Jumlah</label>
        <input type="number" id="sugCount" min="5" max="30" value="15" />
      </div>
    </div>
    <button class="btn btn-primary" id="sugBtn">✨ Minta saran</button>
    <div id="sugResult" style="margin-top:12px"></div>
  `);

  const result = panel.querySelector('#sugResult');

  panel.querySelector('#sugBtn').onclick = async (e) => {
    const brief = panel.querySelector('#sugBrief').value.trim();
    if (!brief) return toast('Isi brief dulu.', 'bad');

    const done = busy(e.target, 'Meminta AI…');
    result.innerHTML = '';
    try {
      const { tags } = await api.suggestHashtags(
        brief,
        panel.querySelector('#sugPlatform').value,
        Number(panel.querySelector('#sugCount').value) || 15
      );
      if (!tags.length) {
        result.append(el('p', 'muted', 'AI tidak mengembalikan hashtag. Coba perjelas brief-nya.'));
        return;
      }
      result.append(buildSuggestResult(tags));
    } catch (err) {
      result.append(el('div', 'alert alert-bad', `Gagal: ${escapeHtml(err.message)}`));
    } finally {
      done();
    }
  };

  return panel;
}

function buildSuggestResult(tags) {
  const box = el('div', 'stack');
  box.append(el('p', 'muted', 'Ketuk untuk memilih/membatalkan:'));

  const chips = el('div', 'chips');
  const boxes = [];
  for (const tag of tags) {
    const chip = el('label', 'chip on');
    const cb = el('input');
    cb.type = 'checkbox';
    cb.checked = true;
    cb.dataset.tag = tag;
    cb.onchange = () => chip.classList.toggle('on', cb.checked);
    chip.append(cb, el('span', null, tag));
    chips.append(chip);
    boxes.push(cb);
  }
  box.append(chips);

  const row = el('div', 'row');

  const saveNew = el('button', 'btn btn-primary btn-sm', 'Simpan jadi set baru');
  saveNew.onclick = async (e) => {
    const chosen = boxes.filter((c) => c.checked).map((c) => c.dataset.tag);
    if (!chosen.length) return toast('Pilih minimal satu hashtag.', 'bad');
    const name = prompt('Nama set baru:');
    if (!name?.trim()) return;

    const done = busy(e.target, 'Menyimpan…');
    try {
      const { set } = await api.createHashtagSet({ name: name.trim(), tags: chosen });
      sets.push(set);
      paint();
      toast(`Set "${set.name}" dibuat dengan ${set.tags.length} hashtag.`, 'ok');
    } catch (err) {
      toast(`Gagal menyimpan: ${err.message}`, 'bad');
    } finally {
      done();
    }
  };

  const addExisting = el('button', 'btn btn-ghost btn-sm', 'Tambahkan ke set yang ada');
  addExisting.onclick = async (e) => {
    const chosen = boxes.filter((c) => c.checked).map((c) => c.dataset.tag);
    if (!chosen.length) return toast('Pilih minimal satu hashtag.', 'bad');
    if (!sets.length) return toast('Belum ada set. Buat set baru dulu.', 'bad');

    const names = sets.map((s, i) => `${i + 1}. ${s.name}`).join('\n');
    const answer = prompt(`Tambahkan ke set mana?\n\n${names}\n\nKetik nomornya:`);
    const index = Number(answer) - 1;
    if (!sets[index]) return;

    const target = sets[index];
    const done = busy(e.target, 'Menyimpan…');
    try {
      const { set } = await api.updateHashtagSet(target.id, { tags: [...target.tags, ...chosen] });
      Object.assign(target, set);
      paint();
      toast(`Ditambahkan ke "${set.name}" — sekarang ${set.tags.length} hashtag.`, 'ok');
    } catch (err) {
      toast(`Gagal menyimpan: ${err.message}`, 'bad');
    } finally {
      done();
    }
  };

  row.append(saveNew, addExisting);
  box.append(row);
  return box;
}

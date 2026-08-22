/**
 * Grup yang sedang aktif.
 *
 * Ini pengaman utama terhadap salah kirim: begitu sebuah grup dipilih, halaman
 * mana pun hanya menampilkan milik grup itu. Channel brand lain tidak muncul di
 * layar sama sekali, jadi salah centang bukan sekadar tercegah — tidak ada yang
 * bisa dicentang.
 *
 * Modul ini SENGAJA tidak mengimpor apa pun. Dia cuma memegang keadaan dan
 * menyiarkan perubahan; yang mengambil datanya app.js, yang memakainya api.js.
 * Kalau modul ini ikut memanggil api.js, keduanya jadi saling impor.
 */

const KUNCI = 'grupAktif';

let daftar = [];
let bawaanId = '';
let aktif = localStorage.getItem(KUNCI) || '';

/** Terima daftar grup dari server dan bereskan pilihan yang sudah basi. */
export function terima({ groups = [], bawaanId: bawaan = '' } = {}) {
  daftar = groups;
  bawaanId = bawaan || groups[0]?.id || '';

  // Grup yang tersimpan di peramban bisa saja sudah dihapus dari server. Kalau
  // dibiarkan, semua halaman tampil kosong tanpa keterangan apa pun.
  if (!daftar.some((g) => g.id === aktif)) simpan(bawaanId);
  return daftar;
}

export const semua = () => daftar;
export const idAktif = () => aktif || bawaanId;
export const grupAktif = () => daftar.find((g) => g.id === idAktif()) || null;
export const namaAktif = () => grupAktif()?.name || 'Semua';

function simpan(id) {
  aktif = id || '';
  if (aktif) localStorage.setItem(KUNCI, aktif);
  else localStorage.removeItem(KUNCI);
}

/** Ganti grup aktif. Halaman yang sedang terbuka digambar ulang lewat event. */
export function setAktif(id) {
  if (id === idAktif()) return;
  simpan(id);
  document.dispatchEvent(new CustomEvent('grup-berubah', { detail: { id: idAktif() } }));
}

/**
 * Server bisa memberi tahu bahwa grup yang kita minta tidak dikenalnya —
 * misalnya karena dihapus dari perangkat lain. Daripada membiarkan halaman
 * tampil kosong, pilihannya dikembalikan ke grup bawaan.
 */
export function periksaBalasan(data) {
  if (!data?.grupTidakDikenal) return false;
  simpan(data.groupId || bawaanId);
  return true;
}

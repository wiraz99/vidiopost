/**
 * Pemeriksa link tujuan.
 *
 * Pinterest satu-satunya platform di aplikasi ini yang menerima link sebagai
 * TUJUAN pin (metadata.pinterest.url); YouTube dan Facebook cuma menempelkannya
 * ke teks. Karena itu masalah link hanya menjatuhkan Pinterest, dan gejalanya
 * membingungkan: Buffer melaporkannya sebagai "Unknown error" tanpa keterangan.
 *
 * Menurut help center Buffer, Pinterest memblokir link yang dipendekkan untuk
 * mencegah spam, dan itu muncul sebagai "Unknown error". Jadi link seperti ini
 * dicegat SEBELUM dikirim — percuma membakar kuota untuk pin yang pasti ditolak.
 */

// Domain pemendek yang umum, termasuk yang lazim dipakai penjual di Indonesia.
const PEMENDEK = new Set([
  'bit.ly', 'bitly.com', 'tinyurl.com', 't.co', 'goo.gl', 'ow.ly', 'buff.ly',
  'is.gd', 'cutt.ly', 'rebrand.ly', 'shorturl.at', 'tiny.cc', 'bit.do', 'rb.gy',
  's.id', 'gg.gg', 'v.gd', 'shrtco.de',
  'shope.ee', 's.shopee.co.id', 'tokopedia.link', 'tokped.link', 'invol.co',
  'lzd.co', 'c.lazada.co.id'
]);

// Bukan pemendek, tapi juga bukan halaman web tujuan yang wajar untuk sebuah pin.
const BUKAN_HALAMAN = new Set(['wa.me', 'api.whatsapp.com', 'chat.whatsapp.com']);

/** Ambil hostname tanpa www. Mengembalikan '' kalau bukan URL yang sah. */
function host(url) {
  try {
    return new URL(String(url).trim()).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return '';
  }
}

const pemendek = (url) => PEMENDEK.has(host(url));
const pesanSingkat = (url) => host(url) || String(url || '').trim();

/**
 * Periksa kelayakan sebuah link sebagai tujuan pin Pinterest.
 * @returns {{blokir: string|null, peringatan: string|null}}
 */
function periksaUntukPinterest(url) {
  const bersih = String(url || '').trim();
  if (!bersih) return { blokir: null, peringatan: null };

  const nama = host(bersih);
  if (!nama) {
    return {
      blokir: `Link tujuan Pinterest tidak berbentuk URL yang sah: "${bersih.slice(0, 60)}"`,
      peringatan: null
    };
  }

  if (PEMENDEK.has(nama)) {
    return {
      blokir:
        `Link tujuan Pinterest memakai pemendek (${nama}). Pinterest memblokir link pendek ` +
        'untuk mencegah spam, dan menolaknya dengan pesan "Unknown error". Ganti dengan URL ' +
        'lengkap di halaman Tautan, atau batasi tautan itu ke platform selain Pinterest.',
      peringatan: null
    };
  }

  if (BUKAN_HALAMAN.has(nama)) {
    return {
      blokir: null,
      peringatan:
        `Tujuan pin mengarah ke ${nama}, bukan halaman web biasa. Pinterest kadang menolak ` +
        'tautan seperti ini; kalau pinnya gagal, coba arahkan ke halaman katalog atau toko.'
    };
  }

  return { blokir: null, peringatan: null };
}

module.exports = { periksaUntukPinterest, pemendek, host, pesanSingkat, PEMENDEK, BUKAN_HALAMAN };

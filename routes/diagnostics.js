/**
 * Diagnosa mandiri — semua pemeriksaan dalam satu panggilan.
 *
 * Dibuat karena mendiagnosa lewat curl menuntut user tahu alamat servernya
 * sendiri dan mengetiknya benar. Aplikasi sudah tahu alamatnya, jadi lebih
 * baik dia yang memeriksa dan melaporkan pakai bahasa manusia.
 *
 * Tidak memakai kuota Buffer: daftar channel dibaca dari cache.
 */
const express = require('express');
const store = require('../lib/store');
const media = require('../lib/media');
const buffer = require('../lib/buffer');
const ai = require('../lib/ai');
const { periksaUntukPinterest } = require('../lib/linkcheck');
const { cariPengganti } = require('../lib/channel-map');
const groups = require('../lib/groups');
const { channelTanpaGrup } = require('../lib/group-scope');
const { resolveLink } = require('./links');
const { asyncHandler } = require('../lib/http');

const router = express.Router();

const ok = (label, detail) => ({ status: 'ok', label, detail });
const warn = (label, detail, fix) => ({ status: 'warn', label, detail, fix });
const bad = (label, detail, fix) => ({ status: 'bad', label, detail, fix });

router.get('/api/diagnostics', asyncHandler(async (req, res) => {
  const checks = [];

  // ---------- alamat publik ----------
  // Alamat yang BENAR-BENAR dipakai browser bisa dibaca dari header request.
  // Membandingkannya dengan PUBLIC_BASE_URL langsung menunjukkan kalau
  // setelannya menunjuk ke domain lain — penyebab paling sering "video tidak
  // bisa diunduh Buffer".
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host || '';
  const alamatSekarang = host ? `${proto}://${host}`.replace(/\/+$/, '') : '';

  const baseUrl = media.PUBLIC_BASE_URL;
  const cocok = alamatSekarang && alamatSekarang.toLowerCase() === baseUrl.toLowerCase();

  if (media.baseUrlLooksLocal()) {
    checks.push(bad(
      'Alamat publik',
      `PUBLIC_BASE_URL berisi "${baseUrl}" — alamat lokal yang tidak bisa dijangkau dari internet.`,
      alamatSekarang
        ? `Ganti PUBLIC_BASE_URL di Coolify menjadi: ${alamatSekarang}`
        : 'Isi PUBLIC_BASE_URL di Coolify dengan alamat yang kamu pakai membuka aplikasi ini.'
    ));
  } else if (alamatSekarang && !cocok) {
    checks.push(bad(
      'Alamat publik',
      `Kamu membuka aplikasi ini lewat "${alamatSekarang}", tapi PUBLIC_BASE_URL berisi "${baseUrl}". ` +
      'Buffer diberi alamat yang kedua, dan itulah yang gagal dia unduh.',
      `Ganti PUBLIC_BASE_URL di Coolify menjadi persis: ${alamatSekarang}`
    ));
    checks[checks.length - 1].salin = alamatSekarang;
  } else {
    checks.push(ok('Alamat publik', baseUrl));
  }

  // ---------- video bisa diunduh Buffer? ----------
  const videos = store.read('videos', []);
  if (!videos.length) {
    checks.push(warn('Video bisa diunduh Buffer', 'Belum ada video di stok, jadi belum bisa diuji.',
      'Upload satu video dulu di halaman Stok Video.'));
  } else {
    const check = await media.checkPublicUrl(videos[0].filename, { force: req.query.refresh === '1' });
    if (check.ok) {
      checks.push(ok('Video bisa diunduh Buffer', check.url));
    } else {
      checks.push(bad('Video bisa diunduh Buffer', check.reason,
        check.status === 401 || check.status === 403
          ? 'Path /media terlindungi. Matikan basic-auth / proteksi Coolify untuk aplikasi ini.'
          : check.adaDiDisk === false
            ? 'Volume penyimpanan kemungkinan tidak ter-mount ke MEDIA_DIR.'
            : `Pastikan PUBLIC_BASE_URL sama persis dengan alamat yang kamu pakai membuka aplikasi ini. Sekarang terisi "${baseUrl}".`
      ));
      checks[checks.length - 1].url = check.url;
      checks[checks.length - 1].httpStatus = check.status;
    }
  }

  // ---------- token & channel Buffer ----------
  const punyaToken = { A: buffer.hasToken('A'), B: buffer.hasToken('B') };
  if (!punyaToken.A && !punyaToken.B) {
    checks.push(bad('Token Buffer', 'BUFFER_TOKEN_A dan BUFFER_TOKEN_B belum diisi.',
      'Isi keduanya di Coolify. Token wajib punya scope posts:write.'));
  } else {
    try {
      const { channels, source } = await buffer.discoverChannels();
      const perAkun = channels.reduce((acc, c) => {
        acc[c.account] = (acc[c.account] || 0) + 1;
        return acc;
      }, {});
      // Channel yang disambungkan ulang di Buffer dapat ID baru, sehingga setelan
      // dan jadwal lama menunjuk channel yang sudah tidak ada. Tanpa pemeriksaan
      // ini, gejalanya cuma "board tidak terbaca" tanpa sebab yang jelas.
      const yatim = cariPengganti({
        channelsSekarang: channels,
        setelanTersimpan: store.read('channel-settings', {}),
        itemJadwal: store.read('plans', []).flatMap((p) => p.items || [])
      });

      if (yatim.length) {
        const rincian = yatim.map((y) => {
          const jumlah = y.itemBelumTerkirim ? `, ${y.itemBelumTerkirim} item jadwal` : '';
          return `${y.lama.label}${jumlah}`;
        }).join('; ');

        checks.push(bad('Channel disambungkan ulang',
          `Ada ${yatim.length} channel yang setelan/jadwalnya menunjuk ID yang sudah tidak ada ` +
          `di Buffer (${rincian}). Itu terjadi kalau channel diputus lalu disambungkan ulang — ` +
          'Buffer memberi ID baru.',
          yatim.some((y) => y.yakin)
            ? 'Buka Pengaturan; di sana ada tawaran memindahkan setelan ke channel penggantinya.'
            : 'Buka Pengaturan, tekan "Muat ulang channel", lalu pilih channel penggantinya.'));
      }

      checks.push(ok('Channel Buffer',
        `${channels.length} channel terbaca (akun A: ${perAkun.A || 0}, akun B: ${perAkun.B || 0}) — sumber: ${source}`));

      // ---------- grup ----------
      // Channel tanpa grup tidak muncul di grup mana pun, jadi tanpa laporan ini
      // dia benar-benar tidak terlihat di layar mana pun.
      const setelanCh = groups.setelanChannel();
      const belumBergrup = channelTanpaGrup(channels, setelanCh);
      if (belumBergrup.length) {
        checks.push(warn('Channel tanpa grup',
          `${belumBergrup.map((c) => c.label).join(', ')} belum ditetapkan grupnya, jadi belum bisa ` +
          'dipakai menjadwalkan apa pun.',
          'Buka Pengaturan → panel Grup, lalu pilih grup untuk channel itu.'));
      }

      const idGrup = new Set(groups.daftar().map((g) => g.id));
      const grupHilang = [...new Set(
        Object.values(setelanCh).map((s) => s?.groupId).filter((g) => g && !idGrup.has(g))
      )];
      if (grupHilang.length) {
        checks.push(bad('Grup sudah tidak ada',
          `Ada channel yang menunjuk grup ${grupHilang.join(', ')} — grup itu sudah dihapus.`,
          'Tetapkan ulang grup channel tersebut di Pengaturan.'));
      }

      // Jadwal yang isinya menunjuk grup berbeda dari grup jadwalnya. Ini yang
      // akan menayangkan konten brand A di channel brand B kalau diteruskan.
      const bawaanGrup = groups.bawaanId();
      const bentrok = [];
      for (const plan of store.read('plans', [])) {
        const grupPlan = plan.groupId || bawaanGrup;
        const salah = (plan.items || []).filter((i) => {
          const g = setelanCh[i.channelId]?.groupId;
          return i.status !== 'sent' && g && g !== grupPlan;
        });
        if (salah.length) bentrok.push(`${salah.length} item di jadwal ${plan.id}`);
      }
      if (bentrok.length) {
        checks.push(bad('Jadwal mencampur grup',
          `${bentrok.join('; ')} menunjuk channel milik grup lain — kemungkinan channelnya dipindah ` +
          'grup setelah jadwalnya dibuat.',
          'Buka jadwalnya; item itu ditandai belum lengkap dan tidak akan ikut terkirim.'));
      }

      // board Pinterest sudah dipilih?
      const pinterest = channels.filter((c) => c.platform === 'pinterest');
      if (pinterest.length) {
        const settings = store.read('channel-settings', {});
        const belum = pinterest.filter((c) => !settings[c.id]?.boardId);
        if (belum.length) {
          checks.push(bad('Board Pinterest',
            `${belum.map((c) => c.label).join(', ')} belum punya board tujuan.`,
            'Pilih board di halaman Jadwal, bagian "2 · Channel tujuan".'));
        } else {
          checks.push(ok('Board Pinterest', 'Sudah dipilih.'));
        }

        // Link tujuan pin. Pinterest satu-satunya platform yang memakai link
        // sebagai TUJUAN, dan menolak link pendek dengan pesan "Unknown error"
        // yang tidak menjelaskan apa pun — gejalanya terlihat di dashboard
        // Buffer sebagai gagal tayang, bukan sebagai penolakan saat dikirim.
        const contoh = videos.find((v) => v.status !== 'done') || videos[0];
        const tujuan = resolveLink(contoh, 'pinterest');
        const { blokir, peringatan } = periksaUntukPinterest(tujuan);

        if (blokir) {
          checks.push(bad('Link tujuan Pinterest', blokir,
            'Buka halaman Tautan, ganti link itu dengan URL lengkap (bukan pemendek), ' +
            'atau batasi tautan tersebut ke platform selain Pinterest.'));
        } else if (peringatan) {
          checks.push(warn('Link tujuan Pinterest', peringatan, null));
        } else if (tujuan) {
          checks.push(ok('Link tujuan Pinterest', tujuan));
        } else {
          checks.push(ok('Link tujuan Pinterest', 'Tidak ada link — pin dikirim tanpa tujuan, itu boleh.'));
        }
      }
    } catch (err) {
      checks.push(bad('Channel Buffer', err.message,
        'Periksa token Buffer di Coolify, pastikan masih berlaku.'));
    }
  }

  // ---------- AI ----------
  if (req.query.skipAi === '1') {
    checks.push(warn('AI (Hermes)', 'Dilewati.', null));
  } else {
    const aiResult = await ai.selfTest();
    if (aiResult.ok) {
      checks.push(ok('AI (Hermes)', `Model "${aiResult.config.model}" membalas normal.`));
    } else {
      checks.push(bad('AI (Hermes)', aiResult.error,
        'Periksa HERMES_API_URL, HERMES_API_KEY, dan HERMES_MODEL di Coolify.'));
    }
  }

  // ---------- kuota ----------
  const usage = buffer.usageSnapshot();
  const sisa = usage.dayLimit - usage.dayCount;
  checks.push(
    sisa < 60
      ? warn('Kuota API Buffer', `Sisa ${sisa} dari ${usage.dayLimit} request hari ini.`,
        'Mengirim satu jadwal penuh (10 video x 6 channel) butuh 60 request.')
      : ok('Kuota API Buffer', `${usage.dayCount}/${usage.dayLimit} terpakai hari ini.`)
  );

  const masalah = checks.filter((c) => c.status === 'bad').length;
  res.json({ semuaBeres: masalah === 0, jumlahMasalah: masalah, checks, publicBaseUrl: baseUrl });
}));

module.exports = router;

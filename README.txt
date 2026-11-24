LAUNDRYSYNC - PANDUAN SINGKAT
==============================

MULAI MENGGUNAKAN APLIKASI
1. Ekstrak folder LaundrySync.
2. Buka folder tersebut di Visual Studio Code.
3. Pastikan konfigurasi Supabase pada file config.js sudah diisi.
4. Jika sedang memperbarui versi satu akun, jalankan file
   supabase_workspace_upgrade.sql di Supabase SQL Editor.
5. Jalankan index.html menggunakan ekstensi Live Server.
6. Masuk menggunakan akun LaundrySync Anda.

PENTING UNTUK PENGGUNA VERSI SEBELUMNYA
- Jangan menghapus proyek Supabase atau tabel yang sudah digunakan.
- Jangan menjalankan ulang supabase_setup.sql jika database sudah dibuat.
- Jalankan supabase_workspace_upgrade.sql untuk menambahkan ruang kerja
  bersama, anggota staf, undangan, dan hak akses.
- Baca SETUP_SUPABASE.md untuk panduan pembaruan dan penambahan staf.

FITUR
- Dasbor dan pengelolaan transaksi laundry
- Login menggunakan email dan kata sandi
- Ruang kerja bersama untuk Admin dan staf
- Profil dengan nama lengkap setiap pengguna
- Kode undangan staf sekali pakai
- Hak akses Admin, Kasir, Produksi, dan Kurir
- Pembatasan akses melalui Supabase RLS dan aturan database
- Penyimpanan transaksi saat offline
- Sinkronisasi data dengan Supabase
- Pembuatan kode QR dan pemindaian kamera
- Verifikasi pesanan dan konfirmasi penyerahan
- Riwayat aktivitas
- Ekspor cadangan data dalam format JSON
- Aplikasi responsif untuk desktop dan ponsel

CARA MENGUNDANG STAF
1. Admin membuka menu Tim & Ruang Kerja.
2. Pilih jabatan staf, lalu buat kode undangan.
3. Staf membuat akun sendiri menggunakan nama dan email masing-masing.
4. Setelah masuk, staf memasukkan kode undangan dari Admin.
5. Staf akan bergabung ke ruang kerja yang sama dengan hak akses sesuai jabatan.

HAK AKSES
Admin: mengelola ruang kerja, anggota staf, seluruh transaksi dan penyerahan.
Kasir: membuat transaksi, mencatat data pelanggan dan pembayaran.
Produksi: memperbarui proses laundry hingga status Siap Diambil.
Kurir: memverifikasi QR dan mengonfirmasi penyerahan pesanan yang sudah siap
dan telah lunas.

PENGGUNAAN OFFLINE
- Transaksi tetap dapat dicatat saat internet terputus jika perangkat sudah pernah memuat aplikasi.
- Jika login online tidak dapat dipulihkan, pilih “Lanjutkan dengan Mode Lokal (Offline)” pada layar masuk.
- Mode Lokal menggunakan profil Admin Lokal dan menyimpan data hanya pada perangkat ini; data Mode Lokal tidak disinkronkan ke Supabase.
- Data yang belum terkirim disimpan dalam antrean lokal perangkat.
- Setelah internet kembali, data akan disinkronkan ke Supabase.
- Setiap akun staf memiliki antrean offline tersendiri pada perangkat tersebut.

PENGATURAN KEAMANAN
- Gunakan hanya Supabase Project URL dan publishable/anon key di config.js.
- Jangan pernah memasukkan service_role key, secret key, atau kata sandi
  database ke dalam file aplikasi.
- Jaga kerahasiaan kode undangan dan bagikan hanya kepada staf yang dituju.
- Data offline tersimpan pada browser/perangkat dan bukan brankas terenkripsi.


FITUR CETAK OFFLINE (58mm) - UPDATE
1. Buka LaundrySync sekali saat online setelah deploy/update agar Service Worker menyimpan QRCode.js.
2. Setelah halaman berhasil dimuat dan service worker aktif, matikan Wi-Fi untuk menguji mode offline.
3. Buat pesanan baru; QR dan struk dapat dicetak dari popup QR.
4. Untuk pesanan lama: buka Transaksi, gunakan tombol QR atau Cetak pada baris pesanan.
5. Tombol "Simpan Struk + QR sebagai PDF" membuka dialog cetak browser. Pilih "Save as PDF" / "Simpan sebagai PDF".
6. Printer thermal 58mm harus sudah terpasang/terhubung ke perangkat. Internet tidak diperlukan untuk mencetak.
Catatan: QRCode.js disimpan oleh Service Worker setelah berhasil diunduh saat online. Pengguna baru harus membuka aplikasi online setidaknya sekali sebelum dapat menghasilkan QR sepenuhnya offline.

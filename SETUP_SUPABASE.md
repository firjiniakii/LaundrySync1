# LaundrySync - Pengaturan Supabase dan Ruang Kerja Staf

Panduan ini digunakan untuk menghubungkan LaundrySync dengan Supabase dan
mengaktifkan ruang kerja bersama untuk Admin, Kasir, Produksi, dan Kurir.

## 1. Perbarui database yang sudah digunakan

Jika LaundrySync versi sebelumnya sudah terhubung ke Supabase dan sudah
memiliki transaksi, gunakan database Supabase yang sama. Jangan menghapus
proyek, tabel, atau data lama.

1. Buka Supabase Dashboard dan pilih proyek LaundrySync Anda.
2. Buka **SQL Editor** lalu pilih **New query**.
3. Buka file `supabase_workspace_upgrade.sql` dari folder LaundrySync.
4. Salin seluruh isi file ke SQL Editor.
5. Klik **Run** dan pastikan proses selesai tanpa kesalahan.
6. Skrip ini menambahkan tabel ruang kerja, anggota, undangan, serta aturan
   keamanan dan hak akses. Data pesanan dan aktivitas lama akan dipindahkan
   ke ruang kerja Admin yang sudah ada.

**Jangan jalankan `supabase_setup.sql` lagi** jika database versi sebelumnya
sudah dibuat. File tersebut hanya digunakan saat pemasangan pertama.

Jika akun lama sudah memiliki transaksi, akun tersebut akan menjadi Admin
ruang kerja dan transaksi lama tetap dipertahankan. Jika akun belum memiliki
ruang kerja, aplikasi akan menampilkan halaman untuk membuat atau bergabung
ke ruang kerja.

## 2. Periksa konfigurasi aplikasi

Buka file `config.js`. Jika aplikasi sebelumnya sudah terhubung, pertahankan
Project URL dan publishable key yang sudah digunakan.

Format konfigurasi:

```js
window.LAUNDRYSYNC_CONFIG = {
  supabaseUrl: "https://PROJECT-ANDA.supabase.co",
  supabasePublishableKey: "PUBLISHABLE_KEY_ANDA"
};
```

Gunakan hanya **publishable key** atau **anon/public key**. Jangan masukkan
`service_role key`, secret key, atau kata sandi database ke dalam aplikasi.

## 3. Jalankan LaundrySync

1. Buka folder LaundrySync di Visual Studio Code.
2. Pastikan ekstensi Live Server tersedia.
3. Klik kanan `index.html`, lalu pilih **Open with Live Server**.
4. Muat ulang browser dengan `Ctrl + Shift + R`.
5. Masuk menggunakan akun yang sudah terdaftar.

## 4. Buat dan undang staf

Setiap anggota tim harus memiliki akun LaundrySync masing-masing.

### Dari akun Admin

1. Buka menu **Tim & Ruang Kerja**.
2. Pilih jabatan staf: Kasir, Produksi, atau Kurir.
3. Klik **Buat Kode Undangan**.
4. Salin kode dan kirim kepada staf yang dituju.
5. Kode hanya dapat digunakan sekali dan berlaku selama 7 hari.

### Dari akun staf

1. Buka alamat LaundrySync yang sama.
2. Pilih **Buat akun**.
3. Masukkan nama lengkap, email, dan kata sandi sendiri.
4. Konfirmasi email jika fitur konfirmasi email di Supabase aktif.
5. Masuk ke LaundrySync.
6. Masukkan kode undangan pada bagian bergabung ke ruang kerja.
7. Staf akan masuk ke ruang kerja yang sama sesuai jabatan yang dipilih Admin.

Staf yang akan bergabung ke usaha yang sudah ada harus menggunakan kode
undangan, bukan membuat ruang kerja baru.

## 5. Hak akses setiap jabatan

| Jabatan | Hak Akses |
|---|---|
| Admin | Mengelola ruang kerja, mengundang staf, mengubah jabatan, menghapus staf, membuat dan memperbarui seluruh pesanan. |
| Kasir | Membuat transaksi, mencatat data pelanggan dan pembayaran, serta melihat pesanan. |
| Produksi | Melihat pesanan dan memperbarui status Diterima, Dicuci, Dikeringkan, Disetrika, hingga Siap Diambil. |
| Kurir | Melihat pesanan dan mengonfirmasi penyerahan melalui QR jika pesanan sudah Siap Diambil dan pembayaran Lunas. |

Hak akses penting juga diperiksa oleh Supabase melalui Row Level Security
(RLS) dan aturan database. Jadi, pembatasan tidak hanya bergantung pada tampilan
tombol di aplikasi.

## 6. Nama profil pengguna

- Nama lengkap dimasukkan saat pendaftaran akun.
- Nama disimpan pada metadata akun Supabase dan keanggotaan ruang kerja.
- Nama serta inisial akan ditampilkan pada profil dan daftar anggota.
- Pengguna dapat memperbarui nama melalui **Tim & Ruang Kerja → Profil Saya**.
- Jabatan ditampilkan sesuai keanggotaan pengguna di ruang kerja.

## 7. Penyimpanan offline dan sinkronisasi

- Pesanan disimpan terlebih dahulu pada perangkat.
- Jika internet terputus, data akan masuk ke antrean sinkronisasi.
- Setelah internet kembali, data yang tertunda dapat dikirim ke Supabase.
- Data online tersedia bagi anggota ruang kerja yang memiliki izin.
- Setiap akun memiliki antrean offline tersendiri pada perangkat yang digunakan.
- Gunakan akun masing-masing saat masuk dari perangkat yang berbeda.

## 8. Pemeriksaan setelah pembaruan

1. Masuk dengan akun Admin lama.
2. Pastikan nama profil dan jabatan Admin sudah benar.
3. Buat kode undangan untuk Kasir.
4. Buat akun staf kedua menggunakan email berbeda.
5. Gabung menggunakan kode undangan.
6. Pastikan kedua akun melihat ruang kerja dan pesanan yang sama.
7. Pastikan Kasir dapat membuat transaksi.
8. Pastikan Produksi hanya dapat memperbarui proses hingga Siap Diambil.
9. Pastikan Kurir hanya dapat mengonfirmasi pesanan yang siap dan lunas.
10. Uji pencatatan offline dan sinkronisasi setelah internet kembali.

## 9. Catatan keamanan

- Kode undangan adalah kode akses sekali pakai. Bagikan hanya kepada staf yang
  dituju.
- Versi ini menggunakan satu ruang kerja untuk setiap akun pengguna.
- Data lokal disimpan di browser/perangkat dan tidak dienkripsi sebagai brankas
  khusus. Gunakan pengamanan perangkat yang memadai.
- Status pembayaran harus sesuai dengan pembayaran yang benar-benar diterima.
- Jangan pernah membagikan Supabase secret key atau service_role key.

## 10. Mode Lokal saat offline

Jika login Supabase tidak dapat diakses, pilih **Lanjutkan dengan Mode Lokal (Offline)** pada layar masuk. Mode ini memungkinkan Admin Lokal mencatat transaksi tanpa internet. Data disimpan hanya pada browser/perangkat tersebut dan tidak otomatis digabungkan atau disinkronkan ke ruang kerja Supabase. Gunakan akun online normal untuk transaksi yang harus dibagikan dengan staf atau perangkat lain.

(() => {
  "use strict";
  const LEGACY_STORAGE_KEY = "laundysync_prototype_v2";
  const LOCAL_MODE_KEY = "laundrySync_local_mode_v1";
  const LOCAL_PROFILE_KEY = "laundrySync_local_profile_v1";
  let localMode = false;
  let localWorkspace = null;
  let activeStorageKey = LEGACY_STORAGE_KEY;
  const $ = id => document.getElementById(id);
  const backend = window.LaundryBackend;
  const money = n => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n || 0);
  const now = () => new Date().toISOString();
  const prettyDate = value => new Date(value).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
  const prettyTime = value => new Date(value).toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  const escapeHTML = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
  const initialState = { orders: [], activities: [], nextNumber: 1001 };
  let state = loadState();
  let toastTimer;
  let authMode = "signin";
  let cloudBusy = false;

  function loadState() {
    try {
      const saved = localStorage.getItem(activeStorageKey);
      if (!saved) return structuredClone(initialState);
      const parsed = JSON.parse(saved);
      return { ...structuredClone(initialState), ...parsed, orders: Array.isArray(parsed.orders) ? parsed.orders : [], activities: Array.isArray(parsed.activities) ? parsed.activities : [] };
    } catch { return structuredClone(initialState); }
  }
  function saveState() {
    try { localStorage.setItem(activeStorageKey, JSON.stringify(state)); }
    catch { showToast("Penyimpanan perangkat penuh. Ekspor cadangan data dan hapus data lama."); }
  }
  function deviceOnline() { return navigator.onLine; }
  function cloudReady() { return Boolean(backend?.configured && backend.user && backend.membership && backend.workspace); }
  function currentRole() { return localMode ? "local_admin" : (backend?.membership?.role || "guest"); }
  function canCreateOrders() { return localMode || ["admin","cashier"].includes(currentRole()); }
  function canUpdateProduction() { return localMode || ["admin","production"].includes(currentRole()); }
  function isAdmin() { return !localMode && currentRole() === "admin"; }
  function displayName() {
    if (localMode) { try { return JSON.parse(localStorage.getItem(LOCAL_PROFILE_KEY) || "{}").name || "Admin Lokal"; } catch { return "Admin Lokal"; } }
    return backend?.membership?.display_name ||
      backend?.user?.user_metadata?.full_name ||
      (backend?.user?.email ? backend.user.email.split("@")[0] : "Pengguna");
  }
  function initials(name) {
    return String(name || "U").trim().split(/\s+/).slice(0,2).map(x => x[0]?.toUpperCase() || "").join("") || "U";
  }
  function activateWorkspaceStorage(workspaceId) {
    // Each staff account gets its own offline queue on a shared browser.
    // This prevents one staff member from uploading another member's unsynced
    // local rows under the wrong authenticated user.
    const userId = backend?.user?.id || "local";
    const key = `laundrySync_workspace_${workspaceId}_${userId}`;
    const existing = localStorage.getItem(key);
    if (existing) {
      try { state = { ...structuredClone(initialState), ...JSON.parse(existing) }; }
      catch { state = structuredClone(initialState); }
    } else {
      // Migrate the previous shared workspace cache to the first account that
      // opens it after this update, then remove the shared key so later staff
      // accounts start with a clean per-user queue and download cloud records.
      const oldSharedKey = `laundrySync_workspace_${workspaceId}`;
      const oldShared = localStorage.getItem(oldSharedKey);
      if (oldShared) {
        try { state = { ...structuredClone(initialState), ...JSON.parse(oldShared) }; }
        catch { state = structuredClone(initialState); }
        localStorage.setItem(key, JSON.stringify(state));
        localStorage.removeItem(oldSharedKey);
      } else {
        const migrated = localStorage.getItem("laundrySync_legacy_migrated_v1");
        if (!migrated) {
          state = loadLegacyState();
          localStorage.setItem("laundrySync_legacy_migrated_v1", "1");
        } else {
          state = structuredClone(initialState);
        }
      }
    }
    activeStorageKey = key;
    saveState();
  }
  function loadLegacyState() {
    try {
      const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
      return raw ? { ...structuredClone(initialState), ...JSON.parse(raw) } : structuredClone(initialState);
    } catch { return structuredClone(initialState); }
  }
  function isOnline() { return deviceOnline(); }
  function showToast(message) {
    const toast = $("toast");
    toast.textContent = message; toast.classList.add("show");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove("show"), 3000);
  }
  function makeCode(prefix) {
    const date = new Date();
    const stamp = `${date.getFullYear()}${String(date.getMonth()+1).padStart(2,"0")}${String(date.getDate()).padStart(2,"0")}`;
    const random = Math.random().toString(36).slice(2,6).toUpperCase();
    return `${prefix}-${stamp}-${random}`;
  }
  function roleLabel(role) {
    return ({ admin: "Admin", cashier: "Kasir", production: "Produksi", delivery: "Kurir", guest: "Pengunjung", local_admin: "Admin Lokal" })[role] || role;
  }
  function statusLabel(status) {
    return ({ "Received": "Diterima", "Washing": "Dicuci", "Drying": "Dikeringkan", "Ironing": "Disetrika", "Ready for pickup": "Siap Diambil", "Completed": "Selesai" })[status] || status;
  }
  function serviceLabel(service) {
    return ({ "Regular Wash": "Cuci Reguler", "Wash & Iron": "Cuci & Setrika", "Express Wash": "Cuci Ekspres" })[service] || service;
  }
  function activityTitleLabel(title) {
    return ({
      "Transaction created": "Transaksi dibuat",
      "Order verified": "Pesanan diverifikasi",
      "Order verification failed": "Verifikasi pesanan gagal",
      "Order status updated": "Status pesanan diperbarui",
      "Laundry handed over": "Laundry diserahkan",
      "Data exported": "Data diekspor",
      "Staff role changed": "Jabatan staf diubah",
      "Staff member removed": "Staf dihapus"
    })[title] || title;
  }
  function syncBadge(order) {
    const text = order.synced ? "Tersinkron" : (cloudReady() ? "Menunggu Sinkronisasi" : "Tersimpan di Perangkat");
    const cls = order.synced ? "sync-synced" : "sync-pending";
    return `<span class="sync-badge ${cls}">${text}</span>`;
  }
  function statusBadge(status) { return `<span class="status-badge status-${status.replaceAll(" ", "-")}">${escapeHTML(statusLabel(status))}</span>`; }

  function addActivity(title, detail) {
    const item = { id: makeCode("ACT"), title, detail, time: now(), owner_id: localMode ? null : (backend?.user?.id || null), synced: false, local_only: localMode };
    state.activities.unshift(item);
    state.activities = state.activities.slice(0, 200);
    saveState();
  }
  function mapCloudOrder(row) {
    return { id: row.order_code, owner_id: row.owner_id, customer: row.customer, phone: row.phone || "", weight: Number(row.weight), service: row.service, rate: Number(row.rate), total: Number(row.total), payment: row.payment, notes: row.notes || "", status: row.status, createdAt: row.created_at, synced: true };
  }
  function mapCloudActivity(row) {
    return { id: row.activity_code, owner_id: row.owner_id, title: row.title, detail: row.detail, time: row.created_at, synced: true };
  }
  function mergeCloudRows(localRows, remoteRows, mapper) {
    const remote = remoteRows.map(mapper);
    const map = new Map(remote.map(item => [item.id, item]));
    localRows.forEach(item => {
      if (!item.synced || !map.has(item.id)) map.set(item.id, item);
    });
    return Array.from(map.values());
  }

  function orderRows(orders, recent = false) {
    return orders.map(order => `<tr>
      <td><span class="order-id">${escapeHTML(order.id)}</span></td>
      <td><span class="customer-cell">${escapeHTML(order.customer)}</span></td>
      ${recent ? "" : `<td>${prettyDate(order.createdAt)}</td>`}
      <td>${escapeHTML(serviceLabel(order.service))}</td>
      ${recent ? "" : `<td>${Number(order.weight).toFixed(1)} kg</td><td>${money(order.total)}</td>`}
      <td>${statusBadge(order.status)}</td><td>${syncBadge(order)}</td>
      ${recent ? "" : `<td class="order-actions-cell">
        <button class="row-action" data-order-qr="${escapeHTML(order.id)}" title="Lihat QR pesanan">QR</button>
        <button class="row-action" data-order-print="${escapeHTML(order.id)}" title="Cetak struk 58mm">Cetak</button>
        ${canUpdateProduction() ? `<button class="row-action" data-order-action="${escapeHTML(order.id)}" title="Perbarui status pesanan">Status</button>` : ""}
      </td>`}
    </tr>`).join("");
  }
  function renderDashboard() {
    const orders = state.orders;
    const name = displayName();
    const workspaceName = backend?.workspace?.name || "Ruang Kerja Laundry Anda";
    $("welcomeName").textContent = name;
    $("workspaceName").textContent = workspaceName;
    $("workspaceEyebrow").textContent = `${workspaceName.toUpperCase()} / RUANG KERJA`;
    $("workspaceRole").textContent = `${roleLabel(currentRole()).toUpperCase()} · RUANG KERJA`;
    $("profileName").textContent = name;
    $("profileRole").textContent = `Akun ${roleLabel(currentRole())}`;
    $("profileInitial").textContent = initials(name);
    $("topAvatar").textContent = initials(name);
    $("workspaceNameInput").value = workspaceName;
    $("profileNameInput").value = name;
    $("profileEmailInput").value = backend?.user?.email || "";
    $("workspaceNameInput").disabled = !isAdmin();
    $("saveWorkspace").classList.toggle("hidden", !isAdmin());
    $("invitePanel").classList.toggle("hidden", !isAdmin());
    $("newOrderTop").classList.toggle("hidden", !canCreateOrders());
    $("newOrderList").classList.toggle("hidden", !canCreateOrders());
    $("quickCreate").classList.toggle("hidden", !canCreateOrders());
    $("emptyCreate").classList.toggle("hidden", !canCreateOrders());
    $("mobileAdd").classList.toggle("hidden", !canCreateOrders());
    $("statTotal").textContent = orders.length;
    $("statProgress").textContent = orders.filter(o => !["Ready for pickup", "Completed"].includes(o.status)).length;
    $("statReady").textContent = orders.filter(o => o.status === "Ready for pickup").length;
    $("statPending").textContent = orders.filter(o => !o.synced).length;
    $("navOrderCount").textContent = orders.length;
    const recent = orders.slice().sort((a,b) => b.createdAt.localeCompare(a.createdAt)).slice(0,5);
    $("recentRows").innerHTML = orderRows(recent, true);
    $("recentEmpty").classList.toggle("hidden", recent.length > 0);
    $("recentRows").closest("table").classList.toggle("hidden", recent.length === 0);
    $("dashboardNotice").querySelector("strong").textContent = !deviceOnline() ? "Anda sedang bekerja offline" : (cloudReady() ? "Ruang kerja online telah terhubung" : "Data tersimpan di perangkat");
    $("dashboardNotice").querySelector("p").textContent = !deviceOnline() ? "Pesanan tersimpan di perangkat ini dan akan dikirim saat internet tersedia." : (cloudReady() ? "Akun online Anda terhubung. Pesanan baru dan data tertunda akan disinkronkan dengan Supabase." : "Data pesanan tersimpan di perangkat ini. Hubungkan Supabase untuk sinkronisasi antarperangkat.");
    $("accountButton").classList.toggle("hidden", !cloudReady() && !localMode);
    if (localMode) $("accountButton").textContent = "Keluar Mode Lokal";
  }
  function renderTransactions() {
    const query = $("transactionSearch").value.trim().toLowerCase();
    const filter = $("statusFilter").value;
    const rows = state.orders.slice().sort((a,b) => b.createdAt.localeCompare(a.createdAt)).filter(o => (filter === "all" || o.status === filter) && (o.id.toLowerCase().includes(query) || o.customer.toLowerCase().includes(query)));
    $("allRows").innerHTML = orderRows(rows);
    $("listEmpty").classList.toggle("hidden", rows.length > 0);
    $("allRows").closest("table").classList.toggle("hidden", rows.length === 0);
  }
  function renderOffline() {
    const online = deviceOnline();
    const pendingOrders = state.orders.filter(o => !o.synced);
    const pendingActivities = state.activities.filter(a => !a.synced);
    const pending = pendingOrders.length + pendingActivities.length;
    $("connectionPill").classList.toggle("offline", !online);
    $("connectionText").textContent = online ? (cloudReady() ? "Online · Terhubung" : "Online · Perangkat") : "Offline";
    $("offlineHero").classList.toggle("is-offline", !online);
    $("offlineHeroIcon").textContent = online ? "✓" : "⌁";
    $("offlineHeroTitle").textContent = online ? (cloudReady() ? "Koneksi online siap" : "Internet tersedia") : "Anda sedang bekerja offline";
    $("offlineHeroText").textContent = online ? (cloudReady() ? "Perangkat Anda terhubung dan sudah masuk ke Supabase." : "Internet tersedia, tetapi Supabase belum terhubung.") : "Pesanan dan perubahan aktivitas akan tetap tersimpan di perangkat hingga koneksi internet kembali.";
    $("offlineHeroBadge").textContent = online ? (cloudReady() ? "ONLINE" : "LOKAL") : "OFFLINE";
    $("pendingBig").textContent = pending;
    $("queueCount").textContent = `${pending} data tertunda`;
    const totalRecords = state.orders.length + state.activities.length;
    const syncedRecords = state.orders.filter(o => o.synced).length + state.activities.filter(a => a.synced).length;
    const percent = totalRecords ? Math.round(syncedRecords / totalRecords * 100) : 0;
    $("syncProgress").style.width = percent + "%";
    $("syncMetaText").textContent = localMode ? "Mode Lokal · data hanya berada di perangkat ini" : (cloudReady() ? (pending ? `${pending} data menunggu sinkronisasi` : "Semua data lokal telah dicadangkan di Supabase") : "Penyimpanan online belum terhubung");
    $("syncPercent").textContent = `${percent}%`;
    $("syncButton").disabled = localMode || !online || !cloudReady() || pending === 0 || cloudBusy;
    $("syncButton").style.opacity = $("syncButton").disabled ? ".55" : "1";
    $("syncMessage").textContent = localMode ? "Mode Lokal aktif. Data hanya tersimpan di perangkat ini dan tidak disinkronkan ke Supabase." : (!cloudReady() ? "Hubungkan proyek Supabase untuk mengaktifkan sinkronisasi data online." : (!online ? "Sambungkan kembali internet untuk mengirim data yang tertunda." : "Pesanan dan riwayat aktivitas yang tertunda akan dikirim ke database Supabase."));
    $("cloudSetupHint").textContent = "Supabase belum terhubung. Lengkapi pengaturan pada file config.js sesuai panduan SETUP_SUPABASE.md.";
    $("cloudSetupHint").classList.toggle("hidden", cloudReady());
    $("queueList").innerHTML = [
      ...pendingOrders.map(o => ({ id:o.id, title:`${o.id} · ${o.customer}`, detail:`${prettyTime(o.createdAt)} · ${o.service}`, type:"Pesanan" })),
      ...pendingActivities.map(a => ({ id:a.id, title:a.title, detail:`${prettyTime(a.time)} · ${a.detail}`, type:"Aktivitas" }))
    ].map(o => `<div class="queue-item"><span class="queue-icon">⇄</span><div><strong>${escapeHTML(o.title)}</strong><small>${escapeHTML(o.detail)}</small></div><span class="sync-badge sync-pending">${o.type}</span></div>`).join("");
    $("queueEmpty").classList.toggle("hidden", pending > 0);
  }
  function renderActivity() {
    $("activityList").innerHTML = state.activities.map(a => `<div class="activity-item"><span class="activity-icon">${a.title.toLowerCase().includes("sync") ? "⇄" : a.title.toLowerCase().includes("verif") ? "✓" : "▤"}</span><div class="activity-copy"><strong>${escapeHTML(activityTitleLabel(a.title))}</strong><p>${escapeHTML(a.detail)}</p></div><span class="activity-time">${prettyTime(a.time)}</span></div>`).join("");
    $("activityEmpty").classList.toggle("hidden", state.activities.length > 0);
  }
  function renderTeam() {
    const role = currentRole();
    $("joinPanel").classList.add("hidden");
    $("workspaceForm").querySelectorAll("input,button").forEach(el => { if (el.id !== "saveWorkspace") el.disabled = !isAdmin() && el.id === "workspaceNameInput"; });
    $("workspaceSaveMessage").textContent = isAdmin() ? "Anda dapat mengubah nama ruang kerja untuk seluruh anggota tim." : "Hanya Admin ruang kerja yang dapat mengubah nama ini.";
    $("invitePanel").classList.toggle("hidden", !isAdmin());
    $("memberList").innerHTML = (state.members || []).map(m => {
      const label = m.display_name || "Anggota Tim";
      const self = m.user_id === backend?.user?.id;
      const roleControl = isAdmin() && m.role !== "admin" && !self
        ? `<div class="member-actions"><select data-member-role="${escapeHTML(m.user_id)}" aria-label="Ubah jabatan ${escapeHTML(label)}"><option value="cashier" ${m.role === "cashier" ? "selected" : ""}>Kasir</option><option value="production" ${m.role === "production" ? "selected" : ""}>Produksi</option><option value="delivery" ${m.role === "delivery" ? "selected" : ""}>Kurir</option></select><button class="btn btn-secondary btn-small" data-remove-member="${escapeHTML(m.user_id)}" type="button">Hapus</button></div>`
        : `<span class="role-chip role-${escapeHTML(m.role)}">${escapeHTML(roleLabel(m.role))}</span>`;
      return `<div class="member-row"><div class="member-avatar">${escapeHTML(initials(label))}</div><div class="member-main"><strong>${escapeHTML(label)}${self ? " (Anda)" : ""}</strong><small>Bergabung pada ${prettyDate(m.joined_at)}</small></div>${roleControl}</div>`;
    }).join("");
    $("memberCount").textContent = `${(state.members || []).length} anggota`;
    $("membersEmpty").classList.toggle("hidden", (state.members || []).length > 0);
    $("profileNameInput").value = displayName();
    $("profileEmailInput").value = backend?.user?.email || "";
  }
  function renderAll() { renderDashboard(); renderTransactions(); renderOffline(); renderActivity(); renderTeam(); }
  function navigate(page) {
    document.querySelectorAll(".page").forEach(p => p.classList.toggle("active", p.id === `page-${page}`));
    document.querySelectorAll(".nav-item,.mobile-nav-item").forEach(b => b.classList.toggle("active", b.dataset.page === page));
    const titles = { dashboard:"Dasbor", transactions:"Transaksi", offline:"Offline & Sinkronisasi", verification:"Verifikasi QR", activity:"Riwayat Aktivitas", team:"Tim & Ruang Kerja" };
    $("pageHeading").textContent = titles[page] || "Dasbor";
    $("sidebar").classList.remove("open");
    window.scrollTo({ top: 0, behavior: "smooth" });
    if (page === "offline") renderOffline();
    if (page === "transactions") renderTransactions();
    if (page === "team" && cloudReady()) backend.fetchMembers().then(m => { state.members = m; renderTeam(); }).catch(e => showToast(e.message));
  }
  function openOrderModal() {
    if (!canCreateOrders()) { showToast("Jabatan Anda tidak memiliki izin untuk membuat transaksi."); return; }
    $("orderForm").reset(); $("pricePreview").textContent = money(0); $("formError").classList.add("hidden");
    $("orderModal").classList.remove("hidden"); $("customerName").focus();
  }
  function closeOrderModal() { $("orderModal").classList.add("hidden"); }
  function calculatePrice() {
    const weight = Number($("laundryWeight").value);
    const rate = Number($("serviceType").selectedOptions[0]?.dataset.price || 0);
    $("pricePreview").textContent = money(weight > 0 && rate > 0 ? Math.round(weight * rate) : 0);
  }
  async function createOrder(event) {
    event.preventDefault();
    if (!canCreateOrders()) {
      showToast("Hanya Admin dan Kasir yang dapat membuat transaksi.");
      return;
    }
    const customer = $("customerName").value.trim();
    const phone = $("customerPhone").value.trim();
    const weight = Number($("laundryWeight").value);
    const service = $("serviceType").value;
    const rate = Number($("serviceType").selectedOptions[0]?.dataset.price || 0);
    const error = $("formError");
    let message = "";
    if (customer.length < 2) message = "Masukkan nama pelanggan minimal 2 karakter.";
    else if (!Number.isFinite(weight) || weight <= 0 || weight > 100) message = "Berat harus lebih dari 0 kg dan maksimal 100 kg.";
    else if (!service || rate <= 0) message = "Pilih jenis layanan laundry yang valid.";
    else if (phone && !/^[0-9+()\-\s]{6,20}$/.test(phone)) message = "Periksa kembali nomor WhatsApp pelanggan.";
    if (message) { error.textContent = message; error.classList.remove("hidden"); return; }

    const id = makeCode("LS");
    const order = { id, owner_id: localMode ? null : (backend?.user?.id || null), customer, phone, weight, service, rate, total: Math.round(weight * rate), payment: $("paymentStatus").value, notes: $("orderNotes").value.trim(), status: "Received", createdAt: now(), synced: false, local_only: localMode };
    state.orders.push(order);
    addActivity("Transaksi dibuat", `Pesanan ${id} untuk ${customer}. Disimpan di perangkat ini.`);
    saveState(); closeOrderModal(); renderAll(); showQr(order);
    if (!localMode && cloudReady() && deviceOnline()) await syncAll();
    else showToast(localMode ? "Transaksi tersimpan di perangkat ini (Mode Lokal). Data tidak disinkronkan ke Supabase." : "Pesanan tersimpan di perangkat ini dan menunggu sinkronisasi.");
  }
  let selectedQrOrder = null;

  function getQrDataUrl(order) {
    const holder = document.createElement("div");
    holder.style.cssText = "position:fixed;left:-10000px;top:0;background:#fff;padding:0";
    document.body.appendChild(holder);
    try {
      if (!window.QRCode) return "";
      new QRCode(holder, {
        text: order.id,
        width: 220,
        height: 220,
        colorDark: "#000000",
        colorLight: "#ffffff",
        correctLevel: QRCode.CorrectLevel.M
      });
      const canvas = holder.querySelector("canvas");
      if (canvas) return canvas.toDataURL("image/png");
      const image = holder.querySelector("img");
      return image?.src || "";
    } catch (error) {
      console.error("QR generation failed:", error);
      return "";
    } finally {
      holder.remove();
    }
  }

  function printOrder(order, mode = "receipt-qr", paper = "thermal") {
    if (!order) {
      showToast("Pesanan tidak ditemukan.");
      return;
    }

    // Generate from the saved order ID. This does not require Supabase or internet
    // once the QRCode library has been cached by the installed service worker.
    const qrDataUrl = mode === "receipt" ? "" : getQrDataUrl(order);
    if (mode !== "receipt" && !qrDataUrl) {
      showToast("Generator QR belum tersedia. Buka LaundrySync sekali saat online, lalu coba lagi.");
      return;
    }

    const popup = window.open("", "_blank", "width=480,height=760");
    if (!popup) {
      showToast("Izinkan pop-up pada browser untuk mencetak atau menyimpan PDF.");
      return;
    }

    const shop = escapeHTML(backend?.workspace?.name || "LaundrySync");
    const id = escapeHTML(order.id);
    const customer = escapeHTML(order.customer);
    const phone = escapeHTML(order.phone || "-");
    const created = escapeHTML(new Date(order.createdAt).toLocaleString("id-ID", {
      day: "2-digit", month: "long", year: "numeric",
      hour: "2-digit", minute: "2-digit"
    }));
    const service = escapeHTML(serviceLabel(order.service));
    const weight = `${Number(order.weight || 0).toLocaleString("id-ID")} kg`;
    const total = escapeHTML(money(order.total));
    const payment = order.payment === "Paid" ? "Lunas" : "Belum Lunas";
    const status = escapeHTML(statusLabel(order.status));
    const notes = escapeHTML(order.notes || "-");
    const isPdf = paper === "pdf";

    popup.document.open();
    popup.document.write(`<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Struk ${id} - ${shop}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color:#111; margin:0 auto; background:#fff; }
  .receipt { width:${isPdf ? "100mm" : "52mm"}; margin:0 auto; padding:${isPdf ? "8mm" : "2mm"}; font-size:${isPdf ? "11pt" : "9pt"}; }
  h1 { text-align:center; font-size:${isPdf ? "18pt" : "14pt"}; margin:0 0 3px; }
  .subtitle,.center { text-align:center; }
  .subtitle { font-size:8pt; margin:0 0 8px; }
  .rule { border-top:1px dashed #333; margin:8px 0; }
  .row { display:flex; justify-content:space-between; gap:8px; margin:5px 0; }
  .row span:first-child { color:#333; }
  .row strong { text-align:right; overflow-wrap:anywhere; }
  .total { font-size:1.12em; font-weight:bold; }
  .qr { text-align:center; margin:10px auto 4px; }
  .qr img { width:${isPdf ? "42mm" : "38mm"}; height:${isPdf ? "42mm" : "38mm"}; image-rendering:pixelated; }
  .order-code { text-align:center; font-weight:bold; letter-spacing:.4px; overflow-wrap:anywhere; }
  .note { font-size:8pt; line-height:1.4; overflow-wrap:anywhere; }
  .footer { text-align:center; font-size:8pt; margin-top:10px; }
  .offline { border:1px solid #777; padding:4px; text-align:center; font-size:8pt; margin-top:8px; }
  @page { size:${isPdf ? "A4" : "58mm auto"}; margin:${isPdf ? "12mm" : "2mm"}; }
  @media print { body { width:auto; } .receipt { margin:0 auto; } }
</style>
</head>
<body>
  <main class="receipt">
    <h1>${shop}</h1>
    <p class="subtitle">STRUK PESANAN LAUNDRY</p>
    <div class="rule"></div>
    <div class="row"><span>Kode</span><strong>${id}</strong></div>
    <div class="row"><span>Tanggal</span><strong>${created}</strong></div>
    <div class="rule"></div>
    <div class="row"><span>Pelanggan</span><strong>${customer}</strong></div>
    <div class="row"><span>No. HP</span><strong>${phone}</strong></div>
    <div class="rule"></div>
    <div class="row"><span>Layanan</span><strong>${service}</strong></div>
    <div class="row"><span>Berat</span><strong>${weight}</strong></div>
    <div class="row total"><span>Total</span><strong>${total}</strong></div>
    <div class="row"><span>Pembayaran</span><strong>${payment}</strong></div>
    <div class="row"><span>Status</span><strong>${status}</strong></div>
    <div class="row"><span>Catatan</span><strong>${notes}</strong></div>
    ${qrDataUrl ? `<div class="rule"></div><div class="qr"><img src="${qrDataUrl}" alt="QR Pesanan"></div><div class="order-code">${id}</div><p class="center note">Pindai QR ini untuk memverifikasi pesanan.</p>` : ""}
    ${!order.synced ? `<div class="offline">OFFLINE · BELUM TERSINKRON</div>` : ""}
    <div class="rule"></div>
    <p class="footer">Terima kasih telah menggunakan layanan kami.</p>
  </main>
  <script>
    window.addEventListener("load", () => {
      const img = document.querySelector(".qr img");
      if (img && !img.complete) img.addEventListener("load", () => setTimeout(() => window.print(), 150));
      else setTimeout(() => window.print(), 250);
    });
  <\/script>
</body>
</html>`);
    popup.document.close();
  }

  function showQr(order) {
    selectedQrOrder = order;
    $("qrOrderId").textContent = order.id;
    $("qrCustomer").textContent = `${order.customer} · ${order.weight} kg · ${money(order.total)}`;
    $("qrcode").innerHTML = "";
    $("qrModal").classList.remove("hidden");
    if (window.QRCode) new QRCode($("qrcode"), { text: order.id, width: 150, height: 150, colorDark: "#15344d", colorLight: "#ffffff", correctLevel: QRCode.CorrectLevel.M });
    else { $("qrcode").textContent = order.id; $("qrcode").style.cssText = "font-weight:700;color:#15344d;padding:25px;text-align:center"; }
  }

  let html5QrCode = null;
  let scannerRunning = false;
  function showVerification(orderId) {
    const id = String(orderId || "").trim().toUpperCase();
    const order = state.orders.find(o => o.id.toUpperCase() === id);
    const box = $("verifyResult");
    box.classList.remove("hidden", "error");
    if (!order) {
      box.classList.add("error");
      box.innerHTML = `<h3>Pesanan tidak ditemukan di perangkat ini</h3><p>Tidak ada transaksi dengan kode <strong>${escapeHTML(id)}</strong>. Masuk ke akun Anda pada perangkat ini dan sinkronkan data terlebih dahulu.</p>`;
      addActivity("Verifikasi pesanan gagal", `Kode pesanan ${id} tidak ditemukan di perangkat ini.`); renderActivity(); return;
    }
    const canRelease = order.status === "Ready for pickup";
    const paid = order.payment === "Paid";
    const canHandover = ["admin","delivery","local_admin"].includes(currentRole()) && canRelease && paid;
    box.innerHTML = `<h3>✓ Pesanan berhasil diverifikasi</h3><p><strong>Kode Pesanan:</strong> ${escapeHTML(order.id)}</p><p><strong>Pelanggan:</strong> ${escapeHTML(order.customer)}</p><p><strong>Layanan:</strong> ${escapeHTML(serviceLabel(order.service))}</p><p><strong>Berat:</strong> ${Number(order.weight).toFixed(1)} kg</p><p><strong>Total:</strong> ${money(order.total)}</p><p><strong>Status Pesanan:</strong> ${escapeHTML(statusLabel(order.status))}</p><p><strong>Pembayaran:</strong> ${escapeHTML(({Paid:"Lunas",Unpaid:"Belum Lunas",Deposit:"Uang Muka"})[order.payment] || order.payment)}</p><p><strong>Status Pengambilan:</strong> ${canRelease && paid ? "Siap Diambil" : (!canRelease ? "Laundry belum siap diambil" : "Pembayaran harus dilunasi terlebih dahulu")}</p>${canHandover ? `<button class="btn btn-primary" id="completeOrder">Konfirmasi Penyerahan</button>` : ""}`;
    addActivity("Pesanan diverifikasi", `Pesanan ${order.id} diperiksa untuk ${order.customer}.`);
    const complete = $("completeOrder");
    if (complete) complete.addEventListener("click", async () => {
      order.status = "Completed"; order.synced = false;
      addActivity("Laundry diserahkan", `Pesanan ${order.id} telah selesai diserahkan.`);
      saveState(); renderAll();
      box.innerHTML = `<h3>✓ Penyerahan berhasil</h3><p>Pesanan ${escapeHTML(order.id)} telah ditandai selesai.</p>`;
      if (cloudReady() && deviceOnline()) await syncAll();
      showToast("Penyerahan pesanan berhasil dicatat.");
    });
  }
  function verifyOrder(event) { event.preventDefault(); showVerification($("verifyId").value); }
  async function startQrScanner() {
    const message = $("scannerMessage");
    if (!window.Html5Qrcode) { message.textContent = "Fitur pemindai QR tidak tersedia. Sambungkan internet lalu muat ulang halaman. Anda tetap dapat memasukkan kode pesanan secara manual."; return; }
    if (!navigator.mediaDevices?.getUserMedia) { message.textContent = "Kamera memerlukan akses melalui localhost atau HTTPS serta izin dari browser."; return; }
    try {
      $("qr-reader").classList.remove("hidden"); $("startScanner").classList.add("hidden"); $("stopScanner").classList.remove("hidden");
      message.textContent = "Menyiapkan kamera. Izinkan akses kamera pada browser Anda.";
      html5QrCode = new Html5Qrcode("qr-reader");
      const cameras = await Html5Qrcode.getCameras();
      if (!cameras.length) throw new Error("Kamera tidak ditemukan.");
      const preferred = cameras.find(c => /back|rear|environment/i.test(c.label)) || cameras[0];
      await html5QrCode.start(preferred.id, { fps:10, qrbox:{width:230,height:230}, aspectRatio:1 }, async text => {
        $("verifyId").value = text.trim(); await stopQrScanner(); showVerification(text); message.textContent = "Kode QR berhasil dipindai.";
      }, () => {});
      scannerRunning = true; message.textContent = "Kamera aktif. Arahkan kode QR ke dalam bingkai pemindaian.";
    } catch (error) {
      await stopQrScanner(); message.textContent = error.message || "Kamera tidak dapat dijalankan. Periksa izin akses kamera."; showToast("Pemindai tidak dapat dijalankan.");
    }
  }
  async function stopQrScanner() {
    if (html5QrCode && scannerRunning) { try { await html5QrCode.stop(); } catch {} }
    if (html5QrCode) { try { await html5QrCode.clear(); } catch {} }
    html5QrCode = null; scannerRunning = false;
    $("qr-reader").classList.add("hidden"); $("startScanner").classList.remove("hidden"); $("stopScanner").classList.add("hidden");
  }

  async function loadCloudData() {
    if (!cloudReady() || !deviceOnline()) return;
    try {
      const [remoteOrders, remoteActivities, members] = await Promise.all([
        backend.fetchOrders(), backend.fetchActivities(), backend.fetchMembers()
      ]);
      state.orders = mergeCloudRows(state.orders, remoteOrders, mapCloudOrder);
      state.activities = mergeCloudRows(state.activities, remoteActivities, mapCloudActivity).sort((a,b) => b.time.localeCompare(a.time)).slice(0,200);
      state.members = members;
      saveState(); renderAll();
    } catch (error) { showToast(`Gagal memuat data online: ${error.message}`); }
  }
  async function syncAll() {
    if (!cloudReady()) { showToast("Hubungkan Supabase dan masuk ke akun Anda untuk mengaktifkan sinkronisasi online."); return; }
    if (!deviceOnline()) { showToast("Tidak ada koneksi internet. Data tetap tersimpan di perangkat ini."); return; }
    if (cloudBusy) return;
    cloudBusy = true; renderOffline();
    try {
      const pendingOrders = state.orders.filter(o => !o.synced && !o.local_only);
      const pendingActivities = state.activities.filter(a => !a.synced && !a.local_only);
      await backend.upsertOrders(pendingOrders);
      await backend.upsertActivities(pendingActivities);
      pendingOrders.forEach(o => o.synced = true);
      pendingActivities.forEach(a => a.synced = true);
      saveState();
      const [remoteOrders, remoteActivities] = await Promise.all([backend.fetchOrders(), backend.fetchActivities()]);
      state.orders = mergeCloudRows(state.orders, remoteOrders, mapCloudOrder);
      state.activities = mergeCloudRows(state.activities, remoteActivities, mapCloudActivity).sort((a,b) => b.time.localeCompare(a.time)).slice(0,200);
      saveState();
      renderAll();
      showToast(`Sinkronisasi berhasil: ${pendingOrders.length} pesanan dan ${pendingActivities.length} catatan aktivitas terkirim.`);
    } catch (error) {
      // Do not mark records synced if the database did not confirm success.
      showToast(`Sinkronisasi gagal. Data lokal tetap tersimpan. ${error.message}`);
    } finally { cloudBusy = false; renderAll(); }
  }
  function syncInBackground() { if (!cloudBusy) syncAll(); }

  function changeStatus(orderId) {
    if (!canUpdateProduction()) { showToast("Jabatan Anda tidak memiliki izin untuk memperbarui status proses laundry."); return; }
    const order = state.orders.find(o => o.id === orderId);
    if (!order) return;
    const statuses = (currentRole() === "admin" || localMode)
      ? ["Received", "Washing", "Drying", "Ironing", "Ready for pickup", "Completed"]
      : ["Received", "Washing", "Drying", "Ironing", "Ready for pickup"];
    const current = statuses.indexOf(order.status);
    if (current < 0 || current >= statuses.length - 1) {
      showToast(currentRole() === "production" ? "Staf Produksi hanya dapat mengubah status hingga Siap Diambil. Kurir mengonfirmasi penyerahan." : "Pesanan ini sudah selesai.");
      return;
    }
    const next = statuses[current + 1];
    if (!confirm(`Ubah status pesanan ${order.id} dari "${statusLabel(order.status)}" menjadi "${statusLabel(next)}"?`)) return;
    order.status = next; order.synced = false;
    addActivity("Status pesanan diperbarui", `${order.id}: ${statusLabel(statuses[current])} → ${statusLabel(next)}.`);
    saveState(); renderAll();
    if (cloudReady() && deviceOnline()) syncAll();
    showToast("Status pesanan berhasil diperbarui.");
  }

  function exportData() {
    const payload = { application:"LaundrySync", exportedAt:now(), note:"Cadangan data LaundrySync. Data online juga tersimpan di Supabase.", orders:state.orders, activities:state.activities };
    const blob = new Blob([JSON.stringify(payload,null,2)], {type:"application/json"});
    const url = URL.createObjectURL(blob); const link = document.createElement("a");
    link.href = url; link.download = `laundysync-backup-${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
    addActivity("Data diekspor", "Cadangan data JSON berhasil diunduh."); renderActivity(); syncInBackground(); showToast("Cadangan data berhasil diunduh.");
  }

  async function refreshWorkspace() {
    const context = await backend.loadWorkspaceContext();
    if (!context) {
      $("workspaceSetupScreen").classList.remove("hidden");
      $("authScreen").classList.add("hidden");
      return false;
    }
    $("workspaceSetupScreen").classList.add("hidden");
    activateWorkspaceStorage(context.workspace.id);
    await loadCloudData();
    renderAll();
    return true;
  }

  async function createWorkspaceFromSetup(event) {
    event.preventDefault();
    const name = $("newWorkspaceName").value.trim();
    const display = displayName();
    try {
      $("workspaceSetupError").classList.add("hidden");
      await backend.createWorkspace(name, display);
      await refreshWorkspace();
      await syncAll();
      showToast("Ruang kerja berhasil dibuat. Anda sekarang menjadi Admin.");
    } catch (error) {
      $("workspaceSetupError").textContent = error.message;
      $("workspaceSetupError").classList.remove("hidden");
    }
  }

  async function joinWorkspaceFromSetup(event) {
    event.preventDefault();
    const code = $("quickJoinCode").value.trim().toUpperCase();
    try {
      $("workspaceSetupError").classList.add("hidden");
      await backend.joinWorkspace(code, displayName());
      await refreshWorkspace();
      await syncAll();
      showToast("Anda berhasil bergabung ke ruang kerja laundry.");
    } catch (error) {
      $("workspaceSetupError").textContent = error.message;
      $("workspaceSetupError").classList.remove("hidden");
    }
  }

  async function createTeamInvite() {
    try {
      const code = await backend.createInvite($("inviteRole").value);
      $("inviteCodeValue").textContent = code;
      $("inviteResult").classList.remove("hidden");
      showToast("Kode undangan berhasil dibuat dan berlaku selama 7 hari.");
    } catch (error) { showToast(error.message); }
  }

  async function saveWorkspaceName(event) {
    event.preventDefault();
    if (!isAdmin()) return;
    try {
      await backend.updateWorkspaceName($("workspaceNameInput").value.trim());
      renderAll();
      showToast("Nama ruang kerja berhasil diperbarui.");
    } catch (error) { showToast(error.message); }
  }

  async function saveProfileName(event) {
    event.preventDefault();
    try {
      const name = $("profileNameInput").value.trim();
      if (localMode) { if (name.length < 2) throw new Error("Nama minimal 2 karakter."); localStorage.setItem(LOCAL_PROFILE_KEY, JSON.stringify({ name })); renderAll(); showToast("Nama Admin Lokal diperbarui."); return; }
      await backend.updateDisplayName(name);
      renderAll();
      showToast("Nama profil berhasil diperbarui.");
    } catch (error) { showToast(error.message); }
  }

  async function copyInviteCode() {
    const code = $("inviteCodeValue").textContent.trim();
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      showToast("Kode undangan berhasil disalin.");
    } catch {
      showToast("Pilih dan salin kode undangan secara manual.");
    }
  }

  async function joinWorkspaceFromTeam(event) {
    event.preventDefault();
    try {
      await backend.joinWorkspace($("joinCode").value.trim().toUpperCase(), displayName());
      await refreshWorkspace();
      await syncAll();
      showToast("Anda berhasil bergabung ke ruang kerja.");
    } catch (error) { showToast(error.message); }
  }

  async function changeMemberRole(userId, role) {
    if (!isAdmin()) return;
    try {
      await backend.setMemberRole(userId, role);
      state.members = await backend.fetchMembers();
      renderTeam();
      addActivity("Jabatan staf diubah", `Jabatan anggota tim diubah menjadi ${roleLabel(role)}.`);
      if (deviceOnline()) syncAll();
      showToast("Jabatan staf berhasil diperbarui.");
    } catch (error) { showToast(error.message); renderTeam(); }
  }
  async function removeMember(userId) {
    if (!isAdmin()) return;
    if (!confirm("Hapus staf ini dari ruang kerja laundry? Staf tersebut akan kehilangan akses ke data bersama.")) return;
    try {
      await backend.removeMember(userId);
      state.members = await backend.fetchMembers();
      renderTeam();
      addActivity("Staf dihapus", "Seorang staf telah dihapus dari ruang kerja ini.");
      if (deviceOnline()) syncAll();
      showToast("Staf berhasil dihapus.");
    } catch (error) { showToast(error.message); }
  }

  function setAuthMode(mode) {
    authMode = mode;
    $("authTitle").textContent = mode === "signin" ? "Masuk ke LaundrySync" : "Buat Akun LaundrySync";
    $("authIntro").textContent = mode === "signin" ? "Masuk untuk mengakses data laundry dari berbagai perangkat." : "Buat akun menggunakan nama lengkap dan email Anda.";
    $("authSubmit").textContent = mode === "signin" ? "Masuk" : "Buat Akun";
    $("signupNameField").classList.toggle("hidden", mode !== "signup");
    $("authFullName").required = mode === "signup";
    $("authSwitchText").innerHTML = mode === "signin" ? 'Belum punya akun? <button type="button" id="authSwitch">Buat akun</button>' : 'Sudah punya akun? <button type="button" id="authSwitch">Masuk</button>';
    $("authSwitch").addEventListener("click", () => setAuthMode(authMode === "signin" ? "signup" : "signin"));
    $("authError").classList.add("hidden");
  }
  function showAuth(message = "") {
    $("authScreen").classList.remove("hidden");
    $("authError").textContent = message; $("authError").classList.toggle("hidden", !message);
    $("accountButton").classList.add("hidden");
  }
  function hideAuth() { $("authScreen").classList.add("hidden"); $("accountButton").classList.remove("hidden"); }
  async function handleAuth(event) {
    event.preventDefault();
    const email = $("authEmail").value.trim();
    const password = $("authPassword").value;
    $("authSubmit").disabled = true; $("authSubmit").textContent = "Mohon tunggu…";
    try {
      if (authMode === "signin") await backend.signIn(email,password);
      else {
        const fullName = $("authFullName").value.trim();
        if (fullName.length < 2) throw new Error("Masukkan nama lengkap Anda.");
        const result = await backend.signUp(email,password,fullName);
        if (!result.session) {
          $("authError").textContent = "Akun berhasil dibuat. Periksa email Anda untuk melakukan konfirmasi, lalu masuk kembali. Jika konfirmasi email dinonaktifkan di Supabase, Anda dapat langsung masuk.";
          $("authError").classList.remove("hidden"); return;
        }
      }
      hideAuth();
      if (backend.user) {
        const fullName = $("authFullName").value.trim();
        if (fullName && !backend.membership) {
          try { await backend.client.auth.updateUser({ data: { full_name: fullName } }); } catch {}
        }
        const hasWorkspace = await refreshWorkspace();
        if (hasWorkspace) await syncAll();
      }
      renderAll(); showToast("Berhasil masuk ke LaundrySync.");
    } catch (error) {
      $("authError").textContent = error.message || "Autentikasi gagal."; $("authError").classList.remove("hidden");
    } finally { $("authSubmit").disabled = false; $("authSubmit").textContent = authMode === "signin" ? "Masuk" : "Buat Akun"; }
  }
  function activateLocalMode() {
    // Set the mode flag before any asynchronous auth startup can finish.
    localMode = true;
    localStorage.setItem(LOCAL_MODE_KEY, "1");
    let profile = {};
    try { profile = JSON.parse(localStorage.getItem(LOCAL_PROFILE_KEY) || "{}"); } catch {}
    if (!profile.name) {
      const entered = prompt("Nama Admin untuk penggunaan lokal:", "Admin Lokal");
      profile.name = (entered || "Admin Lokal").trim() || "Admin Lokal";
      localStorage.setItem(LOCAL_PROFILE_KEY, JSON.stringify(profile));
    }
    let deviceId = localStorage.getItem("laundrySync_local_device_id");
    if (!deviceId) {
      deviceId = `device-${makeCode("LS").toLowerCase()}`;
      localStorage.setItem("laundrySync_local_device_id", deviceId);
    }
    localWorkspace = { id: deviceId, name: "Ruang Kerja Lokal" };
    activeStorageKey = `laundrySync_local_workspace_${deviceId}`;

    // Preserve orders created by earlier builds. The original key accidentally
    // used a Cyrillic 'с'; support both spellings when migrating old browser data.
    const current = localStorage.getItem(activeStorageKey);
    if (current) {
      state = loadState();
    } else {
      const legacyKeys = [LEGACY_STORAGE_KEY, "laundysynс_prototype_v2"];
      let migrated = null;
      for (const key of legacyKeys) {
        try {
          const raw = localStorage.getItem(key);
          if (raw) { migrated = JSON.parse(raw); break; }
        } catch {}
      }
      state = migrated
        ? { ...structuredClone(initialState), ...migrated,
            orders: Array.isArray(migrated.orders) ? migrated.orders : [],
            activities: Array.isArray(migrated.activities) ? migrated.activities : [] }
        : structuredClone(initialState);
      saveState();
    }
    hideAuth();
    $("workspaceSetupScreen").classList.add("hidden");
    $("cloudSetupHint").classList.remove("hidden");
    renderAll();
    showToast("Mode Lokal aktif. Transaksi tersimpan hanya di perangkat ini.");
  }

  async function initializeBackend() {
    if (localStorage.getItem(LOCAL_MODE_KEY) === "1") { activateLocalMode(); return; }

    // Show the sign-in/local-mode screen immediately. Previously the app waited
    // for Supabase.getSession() before showing it; on a poor/offline connection
    // that request could hang, leaving the Guest screen with no usable entry.
    setAuthMode("signin");
    showAuth(backend?.configured
      ? "Memeriksa sesi akun… Jika tidak ada koneksi, Anda dapat memilih Mode Lokal."
      : "Supabase tidak tersedia. Anda tetap dapat menggunakan Mode Lokal untuk mencatat transaksi di perangkat ini.");
    if (!backend?.configured) {
      $("cloudSetupHint").classList.remove("hidden");
      renderAll();
      return;
    }

    try {
      const session = await backend.getSession();
      // The user may have entered Local Mode while Supabase was still loading.
      if (localMode || localStorage.getItem(LOCAL_MODE_KEY) === "1") return;
      if (session?.user) {
        hideAuth();
        const hasWorkspace = await refreshWorkspace();
        if (localMode || localStorage.getItem(LOCAL_MODE_KEY) === "1") return;
        if (hasWorkspace) await syncAll();
      } else {
        setAuthMode("signin"); showAuth();
      }
    } catch (error) {
      if (localMode || localStorage.getItem(LOCAL_MODE_KEY) === "1") return;
      setAuthMode("signin");
      showAuth(`${error.message || "Tidak dapat memeriksa sesi Supabase."} Anda masih dapat memilih Mode Lokal.`);
    }

    if (localMode || localStorage.getItem(LOCAL_MODE_KEY) === "1") return;
    backend.onAuthStateChange(async (event, session) => {
      if (localMode || localStorage.getItem(LOCAL_MODE_KEY) === "1") return;
      if (session?.user) {
        hideAuth();
        try {
          const hasWorkspace = await refreshWorkspace();
          if (!localMode && hasWorkspace) renderAll();
        } catch (error) { showToast(error.message); }
      } else if (event === "SIGNED_OUT") {
        $("workspaceSetupScreen").classList.add("hidden");
        showAuth();
      }
    });
    renderAll();
  }

  function bindEvents() {
    document.querySelectorAll("[data-page]").forEach(b => b.addEventListener("click", () => navigate(b.dataset.page)));
    document.querySelectorAll("[data-goto]").forEach(b => b.addEventListener("click", () => navigate(b.dataset.goto)));
    ["newOrderTop","newOrderList","quickCreate","emptyCreate","mobileAdd"].forEach(id => $(id).addEventListener("click", openOrderModal));
    $("closeModal").addEventListener("click", closeOrderModal); $("cancelOrder").addEventListener("click", closeOrderModal);
    $("orderModal").addEventListener("click", e => { if (e.target === $("orderModal")) closeOrderModal(); });
    $("orderForm").addEventListener("submit", createOrder);
    $("laundryWeight").addEventListener("input", calculatePrice); $("serviceType").addEventListener("change", calculatePrice);
    $("closeQr").addEventListener("click", () => $("qrModal").classList.add("hidden"));
    $("doneQr").addEventListener("click", () => $("qrModal").classList.add("hidden"));
    $("printReceiptAndQr").addEventListener("click", () => printOrder(selectedQrOrder, "receipt-qr", "thermal"));
    $("printReceiptOnly").addEventListener("click", () => printOrder(selectedQrOrder, "receipt", "thermal"));
    $("saveReceiptPdf").addEventListener("click", () => printOrder(selectedQrOrder, "receipt-qr", "pdf"));
    $("qrModal").addEventListener("click", e => { if (e.target === $("qrModal")) $("qrModal").classList.add("hidden"); });
    $("syncButton").addEventListener("click", syncAll);
    $("transactionSearch").addEventListener("input", renderTransactions);
    $("statusFilter").addEventListener("change", renderTransactions);
    $("allRows").addEventListener("click", e => {
      const qrButton = e.target.closest("[data-order-qr]");
      const printButton = e.target.closest("[data-order-print]");
      const statusButton = e.target.closest("[data-order-action]");
      if (qrButton) {
        const order = state.orders.find(o => o.id === qrButton.dataset.orderQr);
        if (order) showQr(order);
      } else if (printButton) {
        const order = state.orders.find(o => o.id === printButton.dataset.orderPrint);
        if (order) printOrder(order, "receipt-qr", "thermal");
      } else if (statusButton) {
        changeStatus(statusButton.dataset.orderAction);
      }
    });
    $("verifyForm").addEventListener("submit", verifyOrder);
    $("startScanner").addEventListener("click", startQrScanner);
    $("stopScanner").addEventListener("click", stopQrScanner);
    $("exportData").addEventListener("click", exportData);
    $("clearActivity").addEventListener("click", () => {
      if (!state.activities.length || !confirm("Hapus riwayat aktivitas dari perangkat ini? Salinan data online tetap tersimpan di Supabase.")) return;
      state.activities = []; saveState(); renderActivity(); renderOffline(); showToast("Riwayat aktivitas lokal berhasil dihapus.");
    });
    $("mobileMenu").addEventListener("click", () => $("sidebar").classList.toggle("open"));
    $("helpButton").addEventListener("click", () => alert("LaundrySync membantu mengelola pesanan, pembayaran, proses pencucian, dan penyerahan laundry. Hubungkan Supabase agar data tersinkron antarperangkat. Saat offline, data tersimpan sementara di perangkat dan akan dikirim kembali saat internet tersedia."));
    $("authForm").addEventListener("submit", handleAuth);
    $("createWorkspaceForm").addEventListener("submit", createWorkspaceFromSetup);
    $("quickJoinForm").addEventListener("submit", joinWorkspaceFromSetup);
    $("workspaceForm").addEventListener("submit", saveWorkspaceName);
    $("profileForm").addEventListener("submit", saveProfileName);
    $("createInvite").addEventListener("click", createTeamInvite);
    $("copyInvite").addEventListener("click", copyInviteCode);
    $("joinWorkspaceForm").addEventListener("submit", joinWorkspaceFromTeam);
    $("memberList").addEventListener("change", e => {
      const select = e.target.closest("[data-member-role]");
      if (select) changeMemberRole(select.dataset.memberRole, select.value);
    });
    $("memberList").addEventListener("click", e => {
      const button = e.target.closest("[data-remove-member]");
      if (button) removeMember(button.dataset.removeMember);
    });
    $("profileButton").addEventListener("click", () => navigate("team"));
    const localModeButton = $("localModeButton");
    if (localModeButton) localModeButton.addEventListener("click", activateLocalMode);
    $("authSwitch").addEventListener("click", () => setAuthMode(authMode === "signin" ? "signup" : "signin"));
    $("accountButton").addEventListener("click", async () => {
      if (localMode) { if (confirm("Keluar dari Mode Lokal? Data lokal tetap tersimpan di perangkat ini.")) { localStorage.removeItem(LOCAL_MODE_KEY); localMode = false; location.reload(); } return; }
      if (!confirm("Keluar dari akun LaundrySync? Data lokal yang belum tersinkron akan tetap tersimpan di perangkat ini.")) return;
      try { await backend.signOut(); showAuth(); showToast("Anda berhasil keluar."); } catch (error) { showToast(error.message); }
    });
    $("verifyId").addEventListener("change", e => e.target.value = e.target.value.trim().toUpperCase());
    window.addEventListener("online", async () => {
      renderAll(); showToast("Koneksi internet terdeteksi.");
      if (cloudReady()) await syncAll();
    });
    window.addEventListener("offline", () => { renderAll(); showToast("Tidak ada koneksi internet. Perubahan akan tetap tersimpan di perangkat ini."); });
    document.addEventListener("keydown", e => { if (e.key === "Escape") { closeOrderModal(); $("qrModal").classList.add("hidden"); $("sidebar").classList.remove("open"); stopQrScanner(); } });
    window.addEventListener("beforeunload", () => { if (html5QrCode && scannerRunning) html5QrCode.stop().catch(() => {}); });
  }

  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
  }
  bindEvents();
  renderAll();
  initializeBackend();
})();
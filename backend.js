(() => {
  "use strict";
  const cfg = window.LAUNDRYSYNC_CONFIG || {};
  const configured = Boolean(cfg.supabaseUrl && cfg.supabasePublishableKey &&
    cfg.supabaseUrl.startsWith("https://") &&
    !cfg.supabaseUrl.includes("YOUR_PROJECT") &&
    !cfg.supabasePublishableKey.includes("YOUR_"));
  let client = null;
  let user = null;
  let membership = null;
  let workspace = null;

  if (configured && window.supabase?.createClient) {
    client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabasePublishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
  }

  async function requireClient() {
    if (!client) throw new Error("Supabase belum dikonfigurasi. Masukkan Project URL dan publishable key ke file config.js.");
    const { data, error } = await client.auth.getUser();
    if (error) throw error;
    if (!data.user) throw new Error("Silakan masuk sebelum menggunakan penyimpanan online.");
    user = data.user;
    return user;
  }
  async function requireWorkspace() {
    await requireClient();
    if (!membership || !workspace) await loadWorkspaceContext();
    if (!membership || !workspace) throw new Error("Akun ini belum terhubung ke ruang kerja laundry.");
    return { user, membership, workspace };
  }

  window.LaundryBackend = {
    configured: Boolean(client),
    get client() { return client; },
    get user() { return user; },
    get membership() { return membership; },
    get workspace() { return workspace; },
    async getSession() {
      if (!client) return null;
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      if (data.session?.user) user = data.session.user;
      return data.session;
    },
    async signIn(email, password) {
      if (!client) throw new Error("Supabase belum dikonfigurasi.");
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw error;
      user = data.user;
      return data;
    },
    async signUp(email, password, fullName) {
      if (!client) throw new Error("Supabase belum dikonfigurasi.");
      const { data, error } = await client.auth.signUp({
        email, password,
        options: { data: { full_name: fullName || "" } }
      });
      if (error) throw error;
      if (data.user && data.session) user = data.user;
      return data;
    },
    async signOut() {
      if (!client) return;
      const { error } = await client.auth.signOut();
      if (error) throw error;
      user = null; membership = null; workspace = null;
    },
    async loadWorkspaceContext() {
      // Reuse the locally persisted authenticated user when offline; calling
      // auth.getUser() here would require a network round trip.
      const current = user || await requireClient();
      const cacheKey = `laundrySync_workspace_context_${current.id}`;
      const readCachedContext = () => {
        try {
          const cached = JSON.parse(localStorage.getItem(cacheKey) || "null");
          if (cached?.membership?.user_id === current.id && cached?.workspace?.id && cached.membership.workspace_id === cached.workspace.id) {
            membership = cached.membership;
            workspace = cached.workspace;
            return { membership, workspace };
          }
        } catch {}
        return null;
      };
      try {
        const { data: member, error: memberError } = await client
          .from("laundry_workspace_members")
          .select("user_id,workspace_id,role,display_name,joined_at")
          .eq("user_id", current.id).maybeSingle();
        if (memberError) throw memberError;
        if (!member) {
          membership = null; workspace = null;
          try { localStorage.removeItem(cacheKey); } catch {}
          return null;
        }
        const { data: ws, error: wsError } = await client
          .from("laundry_workspaces")
          .select("id,name,created_by,created_at")
          .eq("id", member.workspace_id).single();
        if (wsError) throw wsError;
        membership = member; workspace = ws;
        // Keep the last confirmed workspace and role on this device so an
        // already-authenticated staff member can continue creating local
        // transactions during a temporary internet outage. Server-side RLS
        // remains authoritative when queued records are synchronized.
        try { localStorage.setItem(cacheKey, JSON.stringify({ membership, workspace })); } catch {}
        return { membership, workspace };
      } catch (error) {
        const networkFailure = !navigator.onLine || error instanceof TypeError || /network|fetch|timeout|offline/i.test(error.message || "");
        if (networkFailure) {
          const cached = readCachedContext();
          if (cached) return cached;
        }
        throw error;
      }
    },
    async createWorkspace(name, displayName) {
      await requireClient();
      const { data, error } = await client.rpc("ls_create_workspace", {
        p_name: name, p_display_name: displayName
      });
      if (error) throw error;
      await this.loadWorkspaceContext();
      return data;
    },
    async createInvite(role) {
      await requireWorkspace();
      const { data, error } = await client.rpc("ls_create_workspace_invite", { p_role: role });
      if (error) throw error;
      return data;
    },
    async joinWorkspace(code, displayName) {
      await requireClient();
      const { data, error } = await client.rpc("ls_join_workspace", {
        p_code: code, p_display_name: displayName
      });
      if (error) throw error;
      await this.loadWorkspaceContext();
      return data;
    },
    async updateDisplayName(name) {
      await requireWorkspace();
      const { error } = await client.rpc("ls_update_my_display_name", { p_display_name: name });
      if (error) throw error;
      const { error: authError } = await client.auth.updateUser({ data: { full_name: name } });
      if (authError) throw authError;
      membership.display_name = name;
      return true;
    },
    async updateWorkspaceName(name) {
      const ctx = await requireWorkspace();
      if (ctx.membership.role !== "admin") throw new Error("Hanya Admin yang dapat mengubah nama ruang kerja.");
      const { data, error } = await client.from("laundry_workspaces")
        .update({ name }).eq("id", ctx.workspace.id).select("id,name,created_by,created_at").single();
      if (error) throw error;
      workspace = data;
      return data;
    },
    async fetchMembers() {
      const ctx = await requireWorkspace();
      const { data, error } = await client.from("laundry_workspace_members")
        .select("user_id,workspace_id,role,display_name,joined_at")
        .eq("workspace_id", ctx.workspace.id).order("joined_at", { ascending: true });
      if (error) throw error;
      return data || [];
    },
    async setMemberRole(userId, role) {
      await requireWorkspace();
      const { error } = await client.rpc("ls_set_member_role", { p_member_id: userId, p_role: role });
      if (error) throw error;
      return true;
    },
    async removeMember(userId) {
      await requireWorkspace();
      const { error } = await client.rpc("ls_remove_member", { p_member_id: userId });
      if (error) throw error;
      return true;
    },
    async fetchOrders() {
      const ctx = await requireWorkspace();
      const { data, error } = await client.from("laundry_orders").select("*")
        .eq("workspace_id", ctx.workspace.id).order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
    async upsertOrders(orders) {
      const ctx = await requireWorkspace();
      if (!orders.length) return [];
      const payload = orders.map(o => ({
        order_code: o.id,
        owner_id: o.owner_id || ctx.user.id,
        workspace_id: ctx.workspace.id,
        customer: o.customer,
        phone: o.phone || "",
        weight: Number(o.weight),
        service: o.service,
        rate: Number(o.rate),
        total: Number(o.total),
        payment: o.payment,
        notes: o.notes || "",
        status: o.status,
        created_at: o.createdAt,
        updated_at: new Date().toISOString()
      }));
      const { data, error } = await client.from("laundry_orders")
        .upsert(payload, { onConflict: "order_code" }).select();
      if (error) throw error;
      return data || [];
    },
    async fetchActivities() {
      const ctx = await requireWorkspace();
      const { data, error } = await client.from("laundry_activity").select("*")
        .eq("workspace_id", ctx.workspace.id).order("created_at", { ascending: false }).limit(300);
      if (error) throw error;
      return data || [];
    },
    async upsertActivities(activities) {
      const ctx = await requireWorkspace();
      if (!activities.length) return [];
      const payload = activities.map(a => ({
        activity_code: a.id,
        owner_id: a.owner_id || ctx.user.id,
        workspace_id: ctx.workspace.id,
        title: a.title,
        detail: a.detail,
        created_at: a.time
      }));
      const { data, error } = await client.from("laundry_activity")
        .upsert(payload, { onConflict: "activity_code" }).select();
      if (error) throw error;
      return data || [];
    },
    onAuthStateChange(callback) {
      if (!client) return { data: { subscription: { unsubscribe() {} } } };
      return client.auth.onAuthStateChange((event, session) => {
        user = session?.user || null;
        if (!user) { membership = null; workspace = null; }
        callback(event, session);
      });
    }
  };
})();
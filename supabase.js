/* ============================================================================
 *  supabase.js — Supabase client + thin data layer for the CID Platform.
 *  Loaded before auth.js and app.js. Exposes window.CIDDB.
 *  Public anon/publishable key only (see window.CID_SUPABASE). RLS protects data.
 * ========================================================================== */
(function () {
  'use strict';
  var cfg = window.CID_SUPABASE || {};
  var ok = !!(window.supabase && cfg.url && cfg.anonKey && !/PASTE_/.test(cfg.anonKey));
  var client = ok ? window.supabase.createClient(cfg.url, cfg.anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  }) : null;

  window.CIDDB = {
    ready: ok,
    client: client,

    // ---- auth ----
    async getSession() {
      if (!client) return null;
      try { var r = await client.auth.getSession(); return r.data.session; } catch (e) { return null; }
    },
    onAuth(cb) { if (client) client.auth.onAuthStateChange(function (_e, s) { cb(s); }); },
    signInOAuth(provider) {
      return client.auth.signInWithOAuth({ provider: provider, options: { redirectTo: location.href.split('#')[0] } });
    },
    signInEmail(email) {
      return client.auth.signInWithOtp({ email: email, options: { emailRedirectTo: location.href.split('#')[0] } });
    },
    signOut() { return client.auth.signOut(); },

    me: null,   // cached current profile (set by auth.js once approved)
    async profile(uid) {
      if (!client) return null;
      try {
        var r = await client.from('profiles').select('*').eq('id', uid).maybeSingle();
        return r.error ? null : r.data;
      } catch (e) { return null; }   // profiles table may not exist yet -> treat as unapproved
    },
    role() { return this.me ? this.me.role : null; },
    canDelete() { return !!this.me && (this.me.role === 'director' || this.me.role === 'command'); },
    canEdit() { return !!this.me && this.me.active; },

    // ---- generic data layer (used as modules migrate off localStorage) ----
    from(table) { return client.from(table); },
    async list(table, opts) {
      opts = opts || {};
      var q = client.from(table).select(opts.select || '*');
      if (opts.order) q = q.order(opts.order, { ascending: !!opts.ascending });
      if (opts.eq) Object.keys(opts.eq).forEach(function (k) { q = q.eq(k, opts.eq[k]); });
      var r = await q;
      if (r.error) throw r.error;
      return r.data || [];
    },
    insert(table, row) { return client.from(table).insert(row).select(); },
    update(table, id, patch) { return client.from(table).update(patch).eq('id', id).select(); },
    remove(table, id) { return client.from(table).delete().eq('id', id); },
    rpc(fn, args) { return client.rpc(fn, args); },
    subscribe(table, cb) {
      if (!client) return null;
      return client.channel('rt_' + table)
        .on('postgres_changes', { event: '*', schema: 'public', table: table }, cb)
        .subscribe();
    }
  };
})();

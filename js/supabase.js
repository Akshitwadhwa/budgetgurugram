(function () {
  "use strict";
  const config = window.GC_SUPABASE_CONFIG || {};
  if (!window.supabase || !config.url || !config.publishableKey) {
    window.GC_SUPABASE_CLIENT = null;
    return;
  }
  window.GC_SUPABASE_CLIENT = window.supabase.createClient(config.url, config.publishableKey, {
    auth: {persistSession: true, autoRefreshToken: true, detectSessionInUrl: true}
  });
})();

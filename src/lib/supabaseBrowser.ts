import { createClient, SupabaseClient } from "@supabase/supabase-js";

const envUrl = (import.meta as any).env?.VITE_SUPABASE_URL || "";
const envKey = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY || "";

const fallbackUrl = "https://placeholder-project-id.supabase.co";
const fallbackKey = "placeholder-anon-key";

let currentUrl = envUrl && !envUrl.includes("your-supabase") && !envUrl.includes("placeholder") ? envUrl : fallbackUrl;
let currentKey = envKey && !envKey.includes("your-anon-key") && !envKey.includes("placeholder") ? envKey : fallbackKey;

export let isSupabaseConfigured = currentUrl !== fallbackUrl && currentKey !== fallbackKey;

let activeClient: SupabaseClient | null = null;

function getOrCreateClient(): SupabaseClient {
  if (!activeClient) {
    activeClient = createClient(currentUrl, currentKey, {
      auth: {
        storageKey: "tripvault-auth-token",
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false
      }
    });
  }
  return activeClient;
}

export const supabaseBrowser = new Proxy({} as SupabaseClient, {
  get(target, prop, receiver) {
    const client = getOrCreateClient();
    const value = Reflect.get(client, prop, receiver);
    if (typeof value === "function") {
      return value.bind(client);
    }
    return value;
  },
  set(target, prop, value, receiver) {
    const client = getOrCreateClient();
    return Reflect.set(client, prop, value, receiver);
  }
});

/**
 * Configure the client-side Supabase instance dynamically with runtime keys parsed from the backend.
 * Uses a proxy guard to prevent unnecessary recreation of the Supabase client, resolving multiple GoTrueClient warnings.
 */
export function configureSupabaseBrowser(url: string, key: string) {
  if (
    url && 
    key && 
    !url.includes("your-supabase") && 
    !url.includes("placeholder") && 
    !key.includes("your-anon-key") && 
    url !== "" && 
    key !== ""
  ) {
    if (url === currentUrl && key === currentKey) {
      // Already configured with these exact keys. Do not recreate!
      return false;
    }
    
    currentUrl = url;
    currentKey = key;
    isSupabaseConfigured = true;
    
    if (activeClient) {
      activeClient = createClient(currentUrl, currentKey, {
        auth: {
          storageKey: "tripvault-auth-token",
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false
        }
      });
    }
    return true;
  }
  return false;
}

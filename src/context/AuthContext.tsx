import React, { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { supabaseBrowser, configureSupabaseBrowser } from "../lib/supabaseBrowser";

interface AuthContextType {
  session: any | null;
  user: any | null;
  profile: any | null;
  role: "admin" | "guest";
  loading: boolean;
  error: string | null;
  setError: (err: string | null) => void;
  signInWithPassword: (email: string, password: string) => Promise<any>;
  signUp: (email: string, password: string, name: string) => Promise<any>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<any | null>(null);
  const [user, setUser] = useState<any | null>(null);
  const [profile, setProfile] = useState<any | null>(null);
  const [role, setRole] = useState<"admin" | "guest">("guest");
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [initialized, setInitialized] = useState<boolean>(false);

  // Helper to fetch user profiles dynamically and synchronize context role
  async function fetchProfile(currentUser: any, currentSession: any) {
    if (!currentUser) return null;
    try {
      // Rule: Only avishekmajumderpciu@gmail.com is admin
      const email = (currentUser.email || "").trim().toLowerCase();
      const isAdminEmail = email === "avishekmajumderpciu@gmail.com";

      if (isAdminEmail) {
        setRole("admin");
      } else {
        setRole("guest");
      }

      // Synchronize profile row via backend to ensure creation & fetch metadata
      let dbProfile = null;
      if (currentSession?.access_token) {
        try {
          const res = await fetch("/api/me", {
            headers: {
              Authorization: `Bearer ${currentSession.access_token}`
            }
          });
          if (res.ok) {
            dbProfile = await res.json();
          }
        } catch (meErr) {
          console.warn("[AuthContext] Backend profile sync failed, checking client directly:", meErr);
        }
      }

      // Fallback: direct client-side profiles query if backend was bypassed or is offline
      if (!dbProfile || dbProfile.guest) {
        const { data, error: profileErr } = await supabaseBrowser
          .from("profiles")
          .select("*")
          .eq("id", currentUser.id)
          .single();

        if (!profileErr && data) {
          dbProfile = data;
        }
      }

      if (dbProfile && !dbProfile.guest) {
        setProfile(dbProfile);
        // Clean overlay roles from profile
        if (isAdminEmail || dbProfile.role === "admin") {
          setRole("admin");
        } else {
          setRole("guest");
        }
        return dbProfile;
      } else if (isAdminEmail) {
        // Even if profiles table is missing or doesn't have a row, keep setRole("admin")
        setRole("admin");
      }
    } catch (err) {
      console.warn("[AuthContext] Non-blocking profile fetch failed:", err);
    }
    return null;
  }

  const refreshProfile = async () => {
    if (user && session) {
      await fetchProfile(user, session);
    }
  };

  // Step 1: Handle dynamic configuration from backend env and initialize auth session
  useEffect(() => {
    let active = true;

    async function initSupabaseAndAuth() {
      let config = null;
      let retries = 4;
      let delay = 1000;
      for (let i = 0; i < retries; i++) {
        try {
          const configRes = await fetch("/api/config/supabase");
          if (configRes.ok) {
            config = await configRes.json();
            break;
          }
        } catch (err) {
          if (i === retries - 1) {
            console.warn("[AuthContext] Could not load dynamic supabase config:", err);
          } else {
            console.warn(`[AuthContext] Config fetch attempt ${i + 1}/${retries} failed, retrying in ${delay}ms...`);
            await new Promise((resolve) => setTimeout(resolve, delay));
            delay *= 1.5;
          }
        }
      }

      if (config && config.supabaseUrl && config.supabaseAnonKey) {
        configureSupabaseBrowser(config.supabaseUrl, config.supabaseAnonKey);
      }

      if (!active) return;

      // Now query initial session
      try {
        const { data: { session: initialSession } } = await supabaseBrowser.auth.getSession();
        setSession(initialSession);
        const currentUser = initialSession?.user || null;
        setUser(currentUser);
        if (currentUser) {
          await fetchProfile(currentUser, initialSession);
        }
      } catch (err) {
        console.error("[AuthContext] Error retrieving session:", err);
      } finally {
        if (active) {
          setLoading(false);
          setInitialized(true);
        }
      }
    }

    initSupabaseAndAuth();

    return () => {
      active = false;
    };
  }, []);

  // Step 2: Establish standard supabase auth state listener once initialized
  useEffect(() => {
    if (!initialized) return;

    const { data: { subscription } } = supabaseBrowser.auth.onAuthStateChange(async (event, currentSession) => {
      setSession(currentSession);
      const currentUser = currentSession?.user || null;
      setUser(currentUser);

      if (currentUser) {
        await fetchProfile(currentUser, currentSession);
      } else {
        setProfile(null);
        setRole("guest");
      }
      setLoading(false);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [initialized]);

  const signInWithPassword = async (email: string, password: string) => {
    setError(null);
    const { data, error: signInErr } = await supabaseBrowser.auth.signInWithPassword({
      email,
      password
    });
    if (signInErr) {
      setError(signInErr.message);
      throw signInErr;
    }
    return data;
  };

  const signUp = async (email: string, password: string, name: string) => {
    setError(null);
    const { data, error: signUpErr } = await supabaseBrowser.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: name
        }
      }
    });
    if (signUpErr) {
      setError(signUpErr.message);
      throw signUpErr;
    }
    return data;
  };

  const signOut = async () => {
    try {
      setError(null);
      await supabaseBrowser.auth.signOut();
      setSession(null);
      setUser(null);
      setProfile(null);
      setRole("guest");
    } catch (err: any) {
      console.error("[AuthContext] Logout failed:", err);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        session,
        user,
        profile,
        role,
        loading,
        error,
        setError,
        signInWithPassword,
        signUp,
        signOut,
        refreshProfile
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

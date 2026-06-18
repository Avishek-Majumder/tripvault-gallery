import React, { createContext, useContext, useState, useEffect } from "react";
import { useAuth } from "./AuthContext";
import { supabaseBrowser } from "../lib/supabaseBrowser";

export type ThemeMode = "light" | "dark" | "system";

interface ThemeContextType {
  theme: ThemeMode;
  setTheme: (theme: ThemeMode) => Promise<void>;
  currentAppliedTheme: "light" | "dark" | "system";
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { user, profile, refreshProfile } = useAuth();
  const [theme, setThemeState] = useState<ThemeMode>("system");
  const [currentAppliedTheme, setCurrentAppliedTheme] = useState<"light" | "dark" | "system">("system");

  // Synchronize state with current user or localStorage
  useEffect(() => {
    let activeTheme: ThemeMode = "system";
    if (user && profile?.theme_preference) {
      activeTheme = profile.theme_preference as ThemeMode;
    } else {
      const stored = localStorage.getItem("tripvault_theme");
      if (stored === "light" || stored === "dark" || stored === "system") {
        activeTheme = stored;
      }
    }
    setThemeState(activeTheme);
  }, [user, profile]);

  // Apply theme classes to root document elements
  useEffect(() => {
    function applyTheme(mode: ThemeMode) {
      document.documentElement.classList.remove("theme-light", "theme-dark", "theme-system", "dark");
      document.body.classList.remove("theme-light", "theme-dark", "theme-system", "dark");

      if (mode === "dark") {
        document.documentElement.classList.add("theme-dark", "dark");
        document.body.classList.add("theme-dark", "dark");
        setCurrentAppliedTheme("dark");
      } else if (mode === "system") {
        document.documentElement.classList.add("theme-system");
        document.body.classList.add("theme-system");
        setCurrentAppliedTheme("system");
      } else {
        document.documentElement.classList.add("theme-light");
        document.body.classList.add("theme-light");
        setCurrentAppliedTheme("light");
      }
    }

    applyTheme(theme);
  }, [theme]);

  const updateTheme = async (newTheme: ThemeMode) => {
    setThemeState(newTheme);
    if (!user) {
      localStorage.setItem("tripvault_theme", newTheme);
    } else {
      // Sync on profiles database directly
      try {
        const { error: upsertErr } = await supabaseBrowser
          .from("profiles")
          .upsert({
            id: user.id,
            email: user.email,
            theme_preference: newTheme,
            updated_at: new Date().toISOString()
          }, { onConflict: "id" });

        if (!upsertErr) {
          await refreshProfile();
        } else {
          console.warn("[ThemeContext] Backend profiles sync failed, storing locally:", upsertErr.message);
          localStorage.setItem("tripvault_theme", newTheme);
        }
      } catch (err: any) {
        console.warn("[ThemeContext] Profile theme update error:", err.message || err);
        localStorage.setItem("tripvault_theme", newTheme);
      }
    }
  };

  return (
    <ThemeContext.Provider value={{ theme, setTheme: updateTheme, currentAppliedTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useAppTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error("useAppTheme must be used within a ThemeProvider");
  }
  return context;
}

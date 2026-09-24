import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabaseBrowser } from "@/lib/supabase-browser";

export type AppRole =
  | "admin"
  | "solicitante"
  | "cotador"
  | "comprador"
  | "aprovador"
  | "almoxarife"
  | "expedicao";

interface Profile {
  id: string;
  full_name: string | null;
  department: string | null;
  email: string | null;
}

export interface RoleAssignment {
  role: AppRole;
  approvalTier: 1 | 2 | 3 | null;
}

interface AuthContextValue {
  isLoading: boolean;
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  roles: AppRole[];
  roleAssignments: RoleAssignment[];
  approvalTier: 1 | 2 | 3 | null;
  isRecoverySession: boolean;
  signInWithPassword: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  hasRole: (role: AppRole) => boolean;
  resetPasswordForEmail: (email: string, redirectTo: string) => Promise<void>;
  updatePassword: (newPassword: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function loadProfileAndRoles(userId: string) {
  const [{ data: profile, error: profileError }, { data: roles, error: rolesError }] =
    await Promise.all([
      supabaseBrowser
        .from("profiles")
        .select("id, full_name, department, email")
        .eq("id", userId)
        .maybeSingle(),
      supabaseBrowser.from("user_roles").select("role,approval_tier").eq("user_id", userId),
    ]);

  if (profileError) throw profileError;
  if (rolesError) throw rolesError;

  return {
    profile: profile satisfies Profile | null,
    roleAssignments: (roles || []).map((item) => ({
      role: item.role as AppRole,
      approvalTier: item.approval_tier as 1 | 2 | 3 | null,
    })),
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isLoading, setIsLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [roleAssignments, setRoleAssignments] = useState<RoleAssignment[]>([]);
  const [isRecoverySession, setIsRecoverySession] = useState(false);

  const refreshProfile = async () => {
    const currentUser = (await supabaseBrowser.auth.getUser()).data.user ?? user;

    if (!currentUser) {
      setProfile(null);
      setRoles([]);
      setRoleAssignments([]);
      return;
    }

    const result = await loadProfileAndRoles(currentUser.id);
    setProfile(result.profile);
    setRoleAssignments(result.roleAssignments);
    setRoles(result.roleAssignments.map((assignment) => assignment.role));
  };

  useEffect(() => {
    let mounted = true;

    const bootstrap = async () => {
      try {
        const timeout = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("auth_timeout")), 8000),
        );

        const [{ data: sessionData }, { data: userData }] = await Promise.race([
          Promise.all([supabaseBrowser.auth.getSession(), supabaseBrowser.auth.getUser()]),
          timeout,
        ]);

        if (!mounted) return;

        setSession(sessionData.session);
        setUser(userData.user);

        if (userData.user) {
          const result = await loadProfileAndRoles(userData.user.id);
          if (!mounted) return;
          setProfile(result.profile);
          setRoleAssignments(result.roleAssignments);
          setRoles(result.roleAssignments.map((assignment) => assignment.role));
        }
      } catch {
        // timeout ou erro de rede — continua sem sessão (vai para /login)
      } finally {
        if (mounted) setIsLoading(false);
      }
    };

    void bootstrap();

    if (typeof window !== "undefined") {
      const hash = window.location.hash;
      const search = window.location.search;
      setIsRecoverySession(hash.includes("type=recovery") || search.includes("type=recovery"));
    }

    const { data: authListener } = supabaseBrowser.auth.onAuthStateChange((event, nextSession) => {
      setSession(nextSession);
      setUser(nextSession?.user ?? null);
      setIsRecoverySession(event === "PASSWORD_RECOVERY");

      if (!nextSession?.user) {
        setProfile(null);
        setRoles([]);
        setRoleAssignments([]);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      void loadProfileAndRoles(nextSession.user.id)
        .then((result) => {
          if (!mounted) return;
          setProfile(result.profile);
          setRoleAssignments(result.roleAssignments);
          setRoles(result.roleAssignments.map((assignment) => assignment.role));
        })
        .finally(() => {
          if (mounted) setIsLoading(false);
        });
    });

    return () => {
      mounted = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  const approvalTier = useMemo<1 | 2 | 3 | null>(() => {
    const tiers = roleAssignments
      .filter((assignment) => assignment.role === "aprovador" && assignment.approvalTier)
      .map((assignment) => assignment.approvalTier as 1 | 2 | 3);

    if (tiers.length === 0) {
      return null;
    }

    return Math.max(...tiers) as 1 | 2 | 3;
  }, [roleAssignments]);

  const value = useMemo<AuthContextValue>(
    () => ({
      isLoading,
      session,
      user,
      profile,
      roles,
      roleAssignments,
      approvalTier,
      isRecoverySession,
      signInWithPassword: async (email: string, password: string) => {
        const { error } = await supabaseBrowser.auth.signInWithPassword({ email, password });
        if (error) throw error;
      },
      signOut: async () => {
        const { error } = await supabaseBrowser.auth.signOut();
        if (error) throw error;
      },
      refreshProfile,
      hasRole: (role: AppRole) => roles.includes(role),
      resetPasswordForEmail: async (email: string, redirectTo: string) => {
        const { error } = await supabaseBrowser.auth.resetPasswordForEmail(email, { redirectTo });
        if (error) throw error;
      },
      updatePassword: async (newPassword: string) => {
        const { error } = await supabaseBrowser.auth.updateUser({ password: newPassword });
        if (error) throw error;
      },
    }),
    [approvalTier, isLoading, isRecoverySession, profile, roleAssignments, roles, session, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used within AuthProvider.");
  }

  return context;
}

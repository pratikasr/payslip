"use client";

import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { setUnauthenticatedHandler, type Me } from "@/lib/api";
import { roleAllows, type Permission, type Role } from "@/lib/roles";

export interface AuthState {
  /** True when this deployment needs a signed-in member (PAYSLIP_AUTH=required). */
  required: boolean;
  /** The signed-in person and membership; null when sign-in is off or nobody is signed in. */
  me: Me | null;
  role: Role | null;
  /** Whether the signed-in role may do this. With sign-in off everything is allowed, as today. */
  can: (permission: Permission) => boolean;
}

const AuthContext = createContext<AuthState | null>(null);

/** Where to go when a session ends while the console is open. */
function signInUrl(): string {
  const next = `${window.location.pathname}${window.location.search}`;
  return `/sign-in?next=${encodeURIComponent(next)}`;
}

/**
 * The sign-in state for the console, read on the server by the console layout. With sign-in on,
 * a 401 from the service (the session expired or was revoked) sends the person to sign in.
 */
export function AuthProvider({ required, me, children }: { required: boolean; me: Me | null; children: ReactNode }) {
  useEffect(() => {
    if (!required) return;
    setUnauthenticatedHandler(() => window.location.assign(signInUrl()));
    return () => setUnauthenticatedHandler(null);
  }, [required]);
  const value = useMemo<AuthState>(() => {
    const role = (me?.membership?.role as Role | undefined) ?? null;
    return {
      required,
      me,
      role,
      can: (p) => !required || roleAllows(role, p),
    };
  }, [required, me]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** The sign-in state; outside the console (no provider) sign-in is treated as off. */
export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  return ctx ?? OFF;
}

const OFF: AuthState = { required: false, me: null, role: null, can: () => true };

/*
  Roles and what each may do, as the service decides them (service/src/auth/mod.rs). The web
  hides what a role cannot do; the service is the only place permission is decided, so these
  tables must match its `rule` and `Role::allows`.
*/

export type Role = "admin" | "approver" | "accountant" | "viewer";

export const ROLES: Role[] = ["admin", "approver", "accountant", "viewer"];

export type Permission =
  | "read"
  | "view_keys"
  | "manage_contractors"
  | "manage_runs"
  | "sync_wallet"
  | "manage_org"
  | "view_audit"
  | "manage_treasury_key";

const ALLOWED: Record<Permission, Role[]> = {
  read: ["admin", "approver", "accountant", "viewer"],
  view_keys: ["admin", "accountant"],
  manage_contractors: ["admin"],
  manage_runs: ["admin", "approver"],
  sync_wallet: ["admin"],
  manage_org: ["admin"],
  view_audit: ["admin", "accountant"],
  // Create, unlock, lock, replace and move the treasury key; every member reads its state.
  manage_treasury_key: ["admin"],
};

export function roleAllows(role: Role | null | undefined, permission: Permission): boolean {
  return !!role && ALLOWED[permission].includes(role);
}

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Admin",
  approver: "Approver",
  accountant: "Accountant",
  viewer: "Viewer",
};

/** One sentence per role, shown where a role is chosen. */
export const ROLE_HELP: Record<Role, string> = {
  admin: "Everything: people, payroll, viewing keys, the treasury key, members and settings.",
  approver:
    "Runs payroll (create, fund, execute and cancel runs), sets the pay schedule, decides payment requests, and reads everything else.",
  accountant: "Reads everything, exports viewing keys and the books, and reads the audit log.",
  viewer: "Reads people, runs and the treasury.",
};

export function roleLabel(role: string | null | undefined): string {
  return role && role in ROLE_LABELS ? ROLE_LABELS[role as Role] : (role ?? "");
}

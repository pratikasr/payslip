"use client";

import { createAuthClient } from "better-auth/react";

/** Better Auth's browser client: sign in with Google (or the test login), sign out, the session. */
export const authClient = createAuthClient({ basePath: "/api/auth" });

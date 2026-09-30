"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, ApiError, errorMessage, type Me, type Role } from "./api";

export const homeFor = (role: Role) => (role === "DRIVER" ? "/driver" : "/passenger");

// Guards a page: loads /auth/me, sends strangers to /login and the wrong role to its own home.
export function useSession(requiredRole: Role) {
  const router = useRouter();
  const [user, setUser] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .me()
      .then((me) => {
        if (cancelled) return;
        if (me.role !== requiredRole) router.replace(homeFor(me.role));
        else setUser(me);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) router.replace("/login");
        else setError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [requiredRole, router]);

  return { user, setUser, error };
}

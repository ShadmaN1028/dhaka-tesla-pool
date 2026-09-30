"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, type Role } from "@/lib/api";
import { Button } from "./ui";

export function Header({ user }: { user: { name: string; role: Role } }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function logout() {
    setBusy(true);
    try {
      await api.logout();
    } finally {
      router.replace("/login");
    }
  }

  return (
    <header className="border-b border-zinc-200 bg-white">
      <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
        <span className="whitespace-nowrap font-semibold tracking-tight">Dhaka Tesla Pool</span>
        <div className="flex items-center gap-3 text-sm">
          <span className="flex flex-col items-end gap-0.5 sm:flex-row sm:items-center sm:gap-2">
            <span className="font-medium leading-tight">{user.name}</span>
            <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium uppercase leading-none tracking-wide text-zinc-600 sm:text-xs">
              {user.role}
            </span>
          </span>
          <Button variant="secondary" onClick={logout} disabled={busy} className="!px-3 !py-1.5">
            Log out
          </Button>
        </div>
      </div>
    </header>
  );
}

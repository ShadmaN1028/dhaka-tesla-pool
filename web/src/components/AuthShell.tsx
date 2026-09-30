import type { ReactNode } from "react";

export function AuthShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-4 py-10">
      <div className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Dhaka Tesla Pool</h1>
        <p className="mt-1 text-sm text-zinc-500">Share a seat. Split the fare. Survive Dhaka traffic.</p>
      </div>
      <div className="space-y-4 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold">{title}</h2>
        {children}
      </div>
    </main>
  );
}

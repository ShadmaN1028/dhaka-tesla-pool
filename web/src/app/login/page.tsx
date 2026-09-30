"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { AuthShell } from "@/components/AuthShell";
import { Button, ErrorBanner, Field, inputClass } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { homeFor } from "@/lib/session";

const DEMO_PASSWORD = "tesla1234";
const DEMO_CAST = [
  { name: "Nusrat", role: "Passenger" },
  { name: "Rafiq", role: "Passenger" },
  { name: "Shirin", role: "Passenger" },
  { name: "Jashim", role: "Driver" },
];

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .me()
      .then((me) => router.replace(homeFor(me.role)))
      .catch(() => {});
  }, [router]);

  async function signIn(emailAddress: string, pass: string) {
    setBusy(true);
    setError(null);
    try {
      const user = await api.login(emailAddress, pass);
      router.replace(homeFor(user.role));
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void signIn(email, password);
  }

  return (
    <AuthShell title="Log in">
      <form onSubmit={onSubmit} className="space-y-3">
        <Field label="Email">
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Password">
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
          />
        </Field>
        <ErrorBanner message={error} />
        <Button type="submit" disabled={busy} className="w-full">
          {busy ? "Signing in…" : "Log in"}
        </Button>
      </form>

      <div className="space-y-2 border-t border-zinc-200 pt-4">
        <p className="text-sm font-medium text-zinc-700">Demo accounts</p>
        <div className="grid grid-cols-2 gap-2">
          {DEMO_CAST.map((person) => (
            <Button
              key={person.name}
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => void signIn(`${person.name.toLowerCase()}@teslapool.dev`, DEMO_PASSWORD)}
              className="flex-col !items-start gap-0 text-left"
            >
              <span>{person.name}</span>
              <span className="text-xs font-normal text-zinc-500">{person.role}</span>
            </Button>
          ))}
        </div>
      </div>

      <p className="text-center text-sm text-zinc-600">
        New passenger?{" "}
        <Link href="/signup" className="font-medium text-zinc-900 underline">
          Create an account
        </Link>
      </p>
    </AuthShell>
  );
}

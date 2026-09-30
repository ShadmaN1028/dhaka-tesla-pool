import type { ButtonHTMLAttributes, ReactNode } from "react";

export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

export const inputClass =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-base outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 disabled:opacity-60";

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section className={cx("rounded-xl border border-zinc-200 bg-white p-4 shadow-sm sm:p-5", className)}>
      {children}
    </section>
  );
}

const variants = {
  primary: "bg-zinc-900 text-white hover:bg-zinc-700",
  secondary: "border border-zinc-300 bg-white text-zinc-900 hover:bg-zinc-50",
  danger: "border border-red-300 bg-white text-red-700 hover:bg-red-50",
};

export function Button({
  variant = "primary",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof variants }) {
  return (
    <button
      className={cx(
        "inline-flex items-center justify-center whitespace-nowrap rounded-lg px-3.5 py-2.5 text-sm font-medium transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900",
        "disabled:cursor-not-allowed disabled:opacity-50",
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}

export function ErrorBanner({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
      {message}
    </p>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <p role="status" className="py-10 text-center text-sm text-zinc-500">
      {label}
    </p>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="py-4 text-center text-sm text-zinc-500">{children}</p>;
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium text-zinc-700">{label}</span>
      {children}
    </label>
  );
}

import { Link } from "react-router-dom";
import type { ReactNode } from "react";

export function AuthLayout({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-6">
      <div className="w-full max-w-sm">
        <Link to="/" className="font-serif text-lg text-ink">
          Riko
        </Link>
        <h1 className="mt-8 text-title text-ink">{title}</h1>
        <p className="mt-1 text-sm text-ink-muted">{subtitle}</p>
        <div className="mt-8">{children}</div>
      </div>
    </div>
  );
}

export function AuthField({
  label,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="block text-sm">
      <span className="text-label uppercase text-ink-muted">{label}</span>
      <input
        className="mt-1 w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm text-ink outline-none transition-colors duration-150 focus:border-accent"
        {...props}
      />
    </label>
  );
}

export function AuthError({ message }: { message: string | null }) {
  if (!message) {
    return null;
  }
  return (
    <p className="rounded-md border border-lost/30 bg-lost/10 px-3 py-2 text-sm text-lost" role="alert">
      {message}
    </p>
  );
}

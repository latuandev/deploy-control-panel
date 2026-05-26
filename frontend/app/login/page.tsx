"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { LockKeyhole } from "lucide-react";
import { ApiError, login } from "@/lib/api";
import { storeTokens } from "@/lib/auth";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const tokens = await login(username, password);
      storeTokens(tokens);
      router.replace("/dashboard");
    } catch (exc) {
      setError(exc instanceof ApiError ? exc.message : "Login failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-100 px-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded border border-zinc-200 bg-white p-6 shadow-panel"
      >
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded bg-emerald-700 text-white">
            <LockKeyhole aria-hidden="true" size={20} />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-zinc-950">Deploy Control Panel</h1>
            <p className="text-sm text-zinc-600">Sign in with your Django account.</p>
          </div>
        </div>

        <label className="mb-4 block">
          <span className="mb-1 block text-sm font-medium text-zinc-700">Username</span>
          <input
            autoComplete="username"
            className="focus-ring w-full rounded border border-zinc-300 px-3 py-2 text-zinc-950"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            required
          />
        </label>

        <label className="mb-4 block">
          <span className="mb-1 block text-sm font-medium text-zinc-700">Password</span>
          <input
            autoComplete="current-password"
            className="focus-ring w-full rounded border border-zinc-300 px-3 py-2 text-zinc-950"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </label>

        {error ? (
          <div className="mb-4 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </div>
        ) : null}

        <button
          className="focus-ring inline-flex w-full items-center justify-center rounded bg-emerald-700 px-4 py-2 font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-zinc-400"
          disabled={submitting}
          type="submit"
        >
          {submitting ? "Signing in..." : "Sign in"}
        </button>
      </form>
    </main>
  );
}


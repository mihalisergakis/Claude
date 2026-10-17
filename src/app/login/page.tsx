import { sendMagicLink } from "./actions";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ sent?: string; error?: string }> }) {
  const { sent, error } = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <form action={sendMagicLink} className="w-full max-w-sm space-y-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-lg font-semibold">Sign in</h1>
        {sent ? (
          <p className="text-sm text-emerald-700">Check your email for a sign-in link.</p>
        ) : (
          <>
            <input
              name="email"
              type="email"
              required
              placeholder="you@example.com"
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
            />
            <button className="w-full rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white">Email me a link</button>
          </>
        )}
        {error && <p className="text-sm text-red-700">{error}</p>}
      </form>
    </main>
  );
}

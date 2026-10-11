"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Command, LoaderCircle, ShieldCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    setLoading(true);
    try {
      const supabase = createClient();
      if (mode === "sign-in") {
        const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
        if (authError) throw authError;
        router.replace("/");
        router.refresh();
      } else {
        const { data, error: authError } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
        });
        if (authError) throw authError;
        if (!data.session) setMessage("Check your email for the confirmation link, then return here to sign in.");
        else { router.replace("/"); router.refresh(); }
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to complete sign-in. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return <main className="auth-screen"><section className="auth-card">
    <div className="auth-brand"><span className="auth-logo"><Command size={18} /></span>RolePilot</div>
    <div className="auth-kicker"><ShieldCheck size={14} /> PRIVATE PERSONAL WORKSPACE</div>
    <h1>{mode === "sign-in" ? "Welcome back" : "Create your account"}</h1>
    <p className="auth-copy">Sign in to your private job-search dashboard.</p>
    {!isSupabaseConfigured() ? <div className="auth-alert"><b>Supabase setup is needed.</b><br />Add the project URL and publishable key to <code>frontend/.env.local</code> after creating your Supabase project.</div> : <form className="auth-form" onSubmit={submit}>
      <label>Email address<input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" /></label>
      <label>Password<input type="password" autoComplete={mode === "sign-in" ? "current-password" : "new-password"} minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 8 characters" /></label>
      {error && <p className="form-error" role="alert">{error}</p>}{message && <p className="form-message" role="status">{message}</p>}
      <button className="auth-submit" type="submit" disabled={loading}>{loading ? <LoaderCircle className="spin" size={16} /> : null}{mode === "sign-in" ? "Sign in" : "Create account"}<ArrowRight size={15} /></button>
    </form>}
    {isSupabaseConfigured() && <button className="auth-mode" onClick={() => { setMode(mode === "sign-in" ? "sign-up" : "sign-in"); setError(""); setMessage(""); }}>{mode === "sign-in" ? "New to RolePilot? Create an account" : "Already have an account? Sign in"}</button>}
    <div className="auth-foot">Your job-search data is protected by your account’s row-level access rules.</div>
  </section></main>;
}

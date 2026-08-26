import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "../../components/ui/button.js";
import { authClient } from "../../lib/auth-client.js";
import { AuthError, AuthField, AuthLayout } from "./auth-layout.js";

export function SignInPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    const { error: signInError } = await authClient.signIn.email({ email, password });

    setIsSubmitting(false);
    if (signInError) {
      setError(signInError.message ?? "Could not sign in with those credentials.");
      return;
    }
    await authClient.getSession().catch(() => null);
    navigate("/dashboard");
  };

  return (
    <AuthLayout title="Sign in" subtitle="Continue to your dashboard.">
      <form className="space-y-4" onSubmit={handleSubmit}>
        <AuthError message={error} />
        <AuthField
          label="Email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <AuthField
          label="Password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? "Signing in…" : "Sign in"}
        </Button>
      </form>
      <p className="mt-6 text-sm text-ink-muted">
        No account yet?{" "}
        <Link to="/sign-up" className="text-accent transition-colors duration-150 hover:text-accent-hover">
          Create one
        </Link>
      </p>
    </AuthLayout>
  );
}

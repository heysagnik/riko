import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "../../components/ui/button.js";
import { authClient } from "../../lib/auth-client.js";
import { AuthError, AuthField, AuthLayout } from "./auth-layout.js";

export function SignUpPage() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    const { error: signUpError } = await authClient.signUp.email({ name, email, password });

    setIsSubmitting(false);
    if (signUpError) {
      setError(signUpError.message ?? "Could not create your account.");
      return;
    }
    navigate("/onboarding");
  };

  return (
    <AuthLayout title="Create your account" subtitle="Recover failed payments without writing the emails yourself.">
      <form className="space-y-4" onSubmit={handleSubmit}>
        <AuthError message={error} />
        <AuthField label="Name" type="text" autoComplete="name" required value={name} onChange={(e) => setName(e.target.value)} />
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
          autoComplete="new-password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? "Creating account…" : "Create account"}
        </Button>
      </form>
      <p className="mt-6 text-sm text-ink-muted">
        Already have an account?{" "}
        <Link to="/sign-in" className="text-accent transition-colors duration-150 hover:text-accent-hover">
          Sign in
        </Link>
      </p>
    </AuthLayout>
  );
}

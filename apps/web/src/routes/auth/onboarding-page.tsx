import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../../components/ui/button.js";
import { authClient } from "../../lib/auth-client.js";
import { AuthError, AuthField, AuthLayout } from "./auth-layout.js";

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function OnboardingPage() {
  const navigate = useNavigate();
  const [businessName, setBusinessName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    const slug = slugify(businessName);
    const { data: org, error: createError } = await authClient.organization.create({
      name: businessName,
      slug: slug || `merchant-${Date.now()}`,
    });

    if (createError || !org) {
      setIsSubmitting(false);
      setError(createError?.message ?? "Could not create your workspace.");
      return;
    }

    await authClient.organization.setActive({ organizationId: org.id });
    setIsSubmitting(false);
    navigate("/dashboard");
  };

  return (
    <AuthLayout title="Set up your workspace" subtitle="This becomes the name your customers see in outreach emails.">
      <form className="space-y-4" onSubmit={handleSubmit}>
        <AuthError message={error} />
        <AuthField
          label="Business name"
          type="text"
          placeholder="Acme Inc"
          required
          value={businessName}
          onChange={(e) => setBusinessName(e.target.value)}
        />
        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? "Creating workspace…" : "Continue"}
        </Button>
      </form>
    </AuthLayout>
  );
}

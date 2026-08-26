import { useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { Navigate } from "react-router-dom";
import { authClient } from "../lib/auth-client.js";
import { Skeleton } from "../components/ui/skeleton.js";

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function RequireAuth() {
  const location = useLocation();
  const { data: session, isPending: sessionPending, refetch: refetchSession } = authClient.useSession();
  const { data: organizations, isPending: orgsPending } = authClient.useListOrganizations();
  const [isActivating, setIsActivating] = useState(false);
  const [revalidated, setRevalidated] = useState(false);

  const activeOrganizationId = session?.session.activeOrganizationId ?? null;
  const hasOrganizations = (organizations?.length ?? 0) > 0;

  useEffect(() => {
    if (session || sessionPending || revalidated) {
      return;
    }
    setRevalidated(true);
    void refetchSession();
  }, [session, sessionPending, revalidated, refetchSession]);

  useEffect(() => {
    if (!session || sessionPending || orgsPending || activeOrganizationId) {
      return;
    }
    const firstOrg = organizations?.[0];
    setIsActivating(true);
    const ensure = async () => {
      if (firstOrg) {
        await authClient.organization.setActive({ organizationId: firstOrg.id });
        return;
      }
      const base = slugify(session.user.name) || "workspace";
      const { data: org } = await authClient.organization.create({
        name: session.user.name,
        slug: `${base}-${Date.now().toString(36)}`,
      });
      if (org) {
        await authClient.organization.setActive({ organizationId: org.id });
      }
    };
    void ensure().finally(() => setIsActivating(false));
  }, [session, sessionPending, orgsPending, activeOrganizationId, organizations]);

  if (sessionPending || orgsPending || isActivating) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface">
        <Skeleton className="h-8 w-32" />
      </div>
    );
  }

  if (!session) {
    if (!revalidated) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-surface">
          <Skeleton className="h-8 w-32" />
        </div>
      );
    }
    return <Navigate to="/sign-in" state={{ from: location }} replace />;
  }

  return <Outlet />;
}

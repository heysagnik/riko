import { useEffect, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { authClient } from "../lib/auth-client.js";
import { Skeleton } from "../components/ui/skeleton.js";

export function RequireAuth() {
  const location = useLocation();
  const { data: session, isPending: sessionPending } = authClient.useSession();
  const { data: organizations, isPending: orgsPending } = authClient.useListOrganizations();
  const [isActivating, setIsActivating] = useState(false);

  const activeOrganizationId = session?.session.activeOrganizationId ?? null;
  const hasOrganizations = (organizations?.length ?? 0) > 0;

  useEffect(() => {
    if (!session || sessionPending || orgsPending || activeOrganizationId) {
      return;
    }
    const firstOrg = organizations?.[0];
    if (firstOrg) {
      setIsActivating(true);
      authClient.organization.setActive({ organizationId: firstOrg.id }).finally(() => setIsActivating(false));
    }
  }, [session, sessionPending, orgsPending, activeOrganizationId, organizations]);

  if (sessionPending || orgsPending || isActivating) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface">
        <Skeleton className="h-8 w-32" />
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/sign-in" state={{ from: location }} replace />;
  }

  if (!activeOrganizationId && !hasOrganizations) {
    return <Navigate to="/onboarding" replace />;
  }

  if (!activeOrganizationId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface">
        <Skeleton className="h-8 w-32" />
      </div>
    );
  }

  return <Outlet />;
}

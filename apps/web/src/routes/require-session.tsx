import { Navigate, Outlet, useLocation } from "react-router-dom";
import { authClient } from "../lib/auth-client.js";
import { Skeleton } from "../components/ui/skeleton.js";

export function RequireSession() {
  const location = useLocation();
  const { data: session, isPending } = authClient.useSession();

  if (isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface">
        <Skeleton className="h-8 w-32" />
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/sign-in" state={{ from: location }} replace />;
  }

  return <Outlet />;
}

import type { NextFunction, Request, Response } from "express";
import { auth } from "../auth.js";

export interface TenantContext {
  tenantId: string;
  userId: string;
}

declare module "express-serve-static-core" {
  interface Request {
    tenant?: TenantContext;
  }
}

export async function requireTenant(req: Request, res: Response, next: NextFunction): Promise<void> {
  const session = await auth.api.getSession({ headers: req.headers as unknown as Headers });

  if (!session?.session.activeOrganizationId) {
    res.status(401).json({ error: "No active organization for this session" });
    return;
  }

  req.tenant = {
    tenantId: session.session.activeOrganizationId,
    userId: session.user.id,
  };
  next();
}

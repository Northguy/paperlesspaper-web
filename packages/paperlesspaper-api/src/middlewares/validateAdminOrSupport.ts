import httpStatus from "http-status";
import { ApiError } from "@internetderdinge/api";
import type { Request, Response, NextFunction } from "express";

// Use the same verified role claim populated by the shared auth middleware.
const ROLES_CLAIM = "https://memo.wirewire.de/roles";

export const validateAdminOrSupport = (
  req: Request,
  _res: Response,
  next: NextFunction,
): void => {
  const roles = req.auth?.[ROLES_CLAIM];
  if (
    Array.isArray(roles) &&
    (roles.includes("admin") || roles.includes("support"))
  ) {
    next();
    return;
  }
  next(
    new ApiError(
      httpStatus.FORBIDDEN,
      "Device deactivation requires the admin or support role.",
    ),
  );
};

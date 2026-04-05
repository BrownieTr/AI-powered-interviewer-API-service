import type { RequestHandler } from "express";
import jwt from "jsonwebtoken";
import type { Config } from "../config.js";

export function requireAuth(config: Config): RequestHandler {
  return (req, res, next) => {
    const header = req.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) {
      res.status(401).json({ error: "Missing or invalid authorization" });
      return;
    }
    try {
      const payload = jwt.verify(token, config.JWT_SECRET) as jwt.JwtPayload & {
        sub: string;
        email: string;
      };
      if (!payload.sub || !payload.email) {
        res.status(401).json({ error: "Invalid token" });
        return;
      }
      req.auth = payload;
      next();
    } catch {
      res.status(401).json({ error: "Invalid or expired token" });
    }
  };
}

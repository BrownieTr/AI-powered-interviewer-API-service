import type { RequestHandler } from "express";
import type { Pool } from "pg";
import { getUserRoleById } from "../services/userService.js";

export function requireAdmin(db: Pool): RequestHandler {
    return async (req, res, next) => {
        try {
        const userId = req.auth?.sub;
        if (!userId) {
            res.status(401).json({ error: "Missing authentication" });
            return;
        }

            const role = await getUserRoleById(db, userId);
        if (role !== "admin") {
            res.status(403).json({ error: "Admin role required" });
            return;
        }

        next();
        } catch (error) {
        next(error);
        }
    };
}

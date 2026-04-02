import "dotenv/config";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { loadConfig } from "./config.js";
import { getDb } from "./db.js";
import { createInferenceClient } from "./services/hfInference.js";
import { createAuthRouter } from "./routes/auth.js";
import { createUsersRouter } from "./routes/users.js";
import { createPhoneRouter } from "./routes/phone.js";

const config = loadConfig();
const db = getDb(config);
const hf = createInferenceClient(config);

const app = express();
const PORT = config.PORT ?? (Number(process.env.PORT) || 3001);

app.set("trust proxy", 1);

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    contentSecurityPolicy: config.NODE_ENV === "production" ? undefined : false,
  })
);

app.use(
  cors({
    origin: config.CLIENT_ORIGIN ?? process.env.CLIENT_ORIGIN ?? "http://localhost:5173",
    credentials: true,
  })
);

app.use(express.json({ limit: "2mb" }));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
});

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
});

app.use("/api/", apiLimiter);

app.get("/", (_req, res) => {
  res.type("text").send(
    "AI Phone Interview API — use GET /health or the authenticated routes under /api/phone.\n"
  );
});

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.use("/api/auth", authLimiter, createAuthRouter(db, config));
app.use("/api/users", createUsersRouter(db, config));
app.use("/api/phone", createPhoneRouter(db, hf, config));

app.use(
  (
    err: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    console.error(err);
    const message = err instanceof Error ? err.message : "Server error";
    const status =
      err && typeof err === "object" && "status" in err && typeof (err as { status?: number }).status === "number"
        ? (err as { status: number }).status
        : message.includes("Inference") ||
            message.includes("inference") ||
            message.includes("Hugging") ||
            message.includes("provider")
          ? 502
          : 500;
    if (config.NODE_ENV !== "production" && err instanceof Error) {
      res.status(status).json({ error: message, stack: err.stack });
      return;
    }
    res.status(status).json({ error: status === 500 ? "Internal server error" : message });
  }
);

app.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`);
});

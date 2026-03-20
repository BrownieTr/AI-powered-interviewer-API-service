import "dotenv/config";
import cors from "cors";
import express from "express";

const app = express();
const PORT = Number(process.env.PORT) || 3001;

app.use(
  cors({
    origin: process.env.CLIENT_ORIGIN ?? "http://localhost:5173",
    credentials: true,
  })
);
app.use(express.json());

app.get("/", (_req, res) => {
  res.type("text").send(
    "Classroom API — this is the backend only.\nUse GET /health or call it from the client app.\n"
  );
});

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`);
});

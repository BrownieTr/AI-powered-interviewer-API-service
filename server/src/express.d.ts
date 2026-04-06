declare global {
  namespace Express {
    interface Request {
      auth?: { sub: string; email: string; role?: "user" | "admin"; iat?: number; exp?: number };
    }
  }
}

export {};

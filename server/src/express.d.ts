declare global {
  namespace Express {
    interface Request {
      auth?: { sub: string; email: string; iat?: number; exp?: number };
    }
  }
}

export {};

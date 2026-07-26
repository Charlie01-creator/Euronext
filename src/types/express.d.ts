export interface AuthUser {
  id: string;
  email: string;
  role: 'USER' | 'ADMIN';
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      requestId: string;
    }
  }
}

export {};

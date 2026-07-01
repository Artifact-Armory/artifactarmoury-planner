import { User } from './shared';

declare global {
  namespace Express {
    interface Request {
      user?: User;
      userId?: string;
      session?: {
        id: string;
        isAnonymous: boolean;
        tableLimit: number;
      };
    }
  }
}

export {};

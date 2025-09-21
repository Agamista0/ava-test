import { Request, Response, NextFunction } from 'express';
import { TokenPayload } from '@/services/auth';
export interface AuthenticatedRequest extends Request {
    user?: {
        id: string;
        email?: string;
        [key: string]: any;
    };
    tokenPayload?: TokenPayload;
    sessionId?: string;
}
export declare const requireRole: (roles: string[]) => (req: AuthenticatedRequest, res: Response, next: NextFunction) => Response<any, Record<string, any>> | undefined;
export declare const authenticateUser: (req: AuthenticatedRequest, res: Response, next: NextFunction) => Promise<void>;
export declare const optionalAuth: (req: AuthenticatedRequest, res: Response, next: NextFunction) => Promise<void>;
//# sourceMappingURL=auth.d.ts.map
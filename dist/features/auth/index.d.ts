import { Request, Response, NextFunction } from 'express';
export interface AuthenticatedRequest extends Request {
    user?: {
        sub: string;
        role: 'user' | 'support';
        [key: string]: any;
    };
}
export declare function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): Response<any, Record<string, any>> | undefined;
export declare function requireRole(role: 'user' | 'support'): (req: AuthenticatedRequest, res: Response, next: NextFunction) => Response<any, Record<string, any>> | undefined;
//# sourceMappingURL=index.d.ts.map
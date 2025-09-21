export interface EnvironmentConfig {
    PORT: number;
    NODE_ENV: string;
    FRONTEND_URL: string;
    JWT_SECRET: string;
    SUPABASE_URL: string;
    SUPABASE_ANON_KEY: string;
    SUPABASE_SERVICE_KEY: string;
    OPENAI_API_KEY?: string;
    JIRA_BASE_URL?: string;
    JIRA_USERNAME?: string;
    JIRA_API_TOKEN?: string;
    JIRA_PROJECT_KEY?: string;
    GOOGLE_APPLICATION_CREDENTIALS?: string;
    GOOGLE_CLOUD_PROJECT_ID?: string;
    MAX_FILE_SIZE: number;
    UPLOAD_DIR: string;
}
export interface ValidationResult {
    isValid: boolean;
    errors: string[];
    warnings: string[];
    config: Partial<EnvironmentConfig>;
}
export declare function validateEnvironment(): ValidationResult;
export declare function printValidationResults(result: ValidationResult): void;
//# sourceMappingURL=env-validation.d.ts.map
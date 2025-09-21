"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateEnvironment = validateEnvironment;
exports.printValidationResults = printValidationResults;
const dotenv_1 = __importDefault(require("dotenv"));
// Load environment variables
dotenv_1.default.config();
const REQUIRED_VARS = [
    'JWT_SECRET',
    'SUPABASE_URL',
    'SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_KEY'
];
const OPTIONAL_SERVICES = {
    OPENAI: ['OPENAI_API_KEY'],
    JIRA: ['JIRA_BASE_URL', 'JIRA_USERNAME', 'JIRA_API_TOKEN', 'JIRA_PROJECT_KEY'],
    GOOGLE_SPEECH: ['GOOGLE_APPLICATION_CREDENTIALS', 'GOOGLE_CLOUD_PROJECT_ID']
};
const PLACEHOLDER_VALUES = [
    'your-super-secret-jwt-key-here',
    'your-supabase-url',
    'your-supabase-anon-key',
    'your-supabase-service-key',
    'your-openai-api-key',
    'your-openai-api-key-here',
    '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',
    'https://your-domain.atlassian.net',
    'your-jira-email@example.com',
    'your-jira-api-token',
    'YOUR_PROJECT_KEY',
    'path-to-your-service-account-key.json',
    'your-google-cloud-project-id'
];
function isPlaceholderValue(value) {
    return PLACEHOLDER_VALUES.includes(value);
}
function validateJWTSecret(secret) {
    // JWT secret should be at least 32 characters for security
    return secret.length >= 32 && !isPlaceholderValue(secret);
}
function validateSupabaseURL(url) {
    try {
        const parsed = new URL(url);
        return parsed.protocol === 'https:' && parsed.hostname.includes('supabase');
    }
    catch {
        return false;
    }
}
function validateSupabaseKey(key) {
    // Supabase keys are JWT tokens
    return key.startsWith('eyJ') && key.length > 100 && !isPlaceholderValue(key);
}
function validateOpenAIKey(key) {
    return key.startsWith('sk-') && key.length > 20 && !isPlaceholderValue(key);
}
function validateJiraURL(url) {
    try {
        const parsed = new URL(url);
        return parsed.protocol === 'https:' && parsed.hostname.includes('atlassian.net');
    }
    catch {
        return false;
    }
}
function validateEnvironment() {
    const errors = [];
    const warnings = [];
    const config = {};
    // Validate required variables
    for (const varName of REQUIRED_VARS) {
        const value = process.env[varName];
        if (!value) {
            errors.push(`Missing required environment variable: ${varName}`);
            continue;
        }
        if (isPlaceholderValue(value)) {
            errors.push(`Environment variable ${varName} contains a placeholder value. Please set a real value.`);
            continue;
        }
        // Specific validations
        switch (varName) {
            case 'JWT_SECRET':
                if (!validateJWTSecret(value)) {
                    errors.push('JWT_SECRET must be at least 32 characters long and not a placeholder');
                }
                else {
                    config.JWT_SECRET = value;
                }
                break;
            case 'SUPABASE_URL':
                if (!validateSupabaseURL(value)) {
                    errors.push('SUPABASE_URL must be a valid HTTPS Supabase URL');
                }
                else {
                    config.SUPABASE_URL = value;
                }
                break;
            case 'SUPABASE_ANON_KEY':
            case 'SUPABASE_SERVICE_KEY':
                if (!validateSupabaseKey(value)) {
                    errors.push(`${varName} must be a valid Supabase JWT key`);
                }
                else {
                    config[varName] = value;
                }
                break;
            default:
                config[varName] = value;
        }
    }
    // Validate optional server configuration
    config.PORT = parseInt(process.env.PORT || '3000', 10);
    config.NODE_ENV = process.env.NODE_ENV || 'development';
    config.FRONTEND_URL = process.env.FRONTEND_URL || '*';
    config.MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE || '10485760', 10);
    config.UPLOAD_DIR = process.env.UPLOAD_DIR || 'uploads';
    // Validate optional services
    for (const [serviceName, serviceVars] of Object.entries(OPTIONAL_SERVICES)) {
        const serviceValues = serviceVars.map(varName => process.env[varName]).filter(Boolean);
        const hasAllVars = serviceVars.every(varName => process.env[varName]);
        const hasAnyVars = serviceValues.length > 0;
        if (hasAnyVars && !hasAllVars) {
            warnings.push(`${serviceName} service is partially configured. Missing: ${serviceVars.filter(v => !process.env[v]).join(', ')}`);
        }
        if (hasAllVars) {
            // Specific service validations
            switch (serviceName) {
                case 'OPENAI':
                    const openaiKey = process.env.OPENAI_API_KEY;
                    if (!validateOpenAIKey(openaiKey)) {
                        warnings.push('OPENAI_API_KEY appears to be invalid or a placeholder. AI features will be disabled.');
                    }
                    else {
                        config.OPENAI_API_KEY = openaiKey;
                    }
                    break;
                case 'JIRA':
                    const jiraUrl = process.env.JIRA_BASE_URL;
                    if (!validateJiraURL(jiraUrl)) {
                        warnings.push('JIRA_BASE_URL appears to be invalid. Jira integration will be disabled.');
                    }
                    else {
                        config.JIRA_BASE_URL = jiraUrl;
                        config.JIRA_USERNAME = process.env.JIRA_USERNAME;
                        config.JIRA_API_TOKEN = process.env.JIRA_API_TOKEN;
                        config.JIRA_PROJECT_KEY = process.env.JIRA_PROJECT_KEY;
                    }
                    break;
                case 'GOOGLE_SPEECH':
                    config.GOOGLE_APPLICATION_CREDENTIALS = process.env.GOOGLE_APPLICATION_CREDENTIALS;
                    config.GOOGLE_CLOUD_PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT_ID;
                    break;
            }
        }
        else if (!hasAnyVars) {
            warnings.push(`${serviceName} service is not configured. Related features will be disabled.`);
        }
    }
    // Security warnings for development
    if (config.NODE_ENV === 'development') {
        if (config.FRONTEND_URL === '*') {
            warnings.push('CORS is set to allow all origins (*). This is not recommended for production.');
        }
    }
    return {
        isValid: errors.length === 0,
        errors,
        warnings,
        config
    };
}
function printValidationResults(result) {
    console.log('\n🔍 Environment Validation Results:');
    console.log('=====================================');
    if (result.isValid) {
        console.log('✅ All required environment variables are valid');
    }
    else {
        console.log('❌ Environment validation failed');
        console.log('\nErrors:');
        result.errors.forEach(error => console.log(`  • ${error}`));
    }
    if (result.warnings.length > 0) {
        console.log('\nWarnings:');
        result.warnings.forEach(warning => console.log(`  ⚠️  ${warning}`));
    }
    // Print service status
    console.log('\n📊 Service Status:');
    console.log(`  • Core API: ${result.isValid ? '✅ Ready' : '❌ Not Ready'}`);
    console.log(`  • OpenAI: ${result.config.OPENAI_API_KEY ? '✅ Enabled' : '⚠️  Disabled'}`);
    console.log(`  • Jira: ${result.config.JIRA_BASE_URL ? '✅ Enabled' : '⚠️  Disabled'}`);
    console.log(`  • Google Speech: ${result.config.GOOGLE_APPLICATION_CREDENTIALS ? '✅ Enabled' : '⚠️  Disabled'}`);
    console.log('=====================================\n');
}
//# sourceMappingURL=env-validation.js.map
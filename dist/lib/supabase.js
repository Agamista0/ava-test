"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createUserClient = exports.supabaseAdmin = void 0;
const supabase_js_1 = require("@supabase/supabase-js");
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Missing Supabase environment variables');
}
// Service role client (for admin operations)
exports.supabaseAdmin = (0, supabase_js_1.createClient)(supabaseUrl, supabaseServiceKey, {
    auth: {
        autoRefreshToken: false,
        persistSession: false
    }
});
// Helper to create client with user JWT
const createUserClient = (userJwt) => {
    return (0, supabase_js_1.createClient)(supabaseUrl, process.env.SUPABASE_ANON_KEY, {
        global: {
            headers: {
                Authorization: `Bearer ${userJwt}`
            }
        }
    });
};
exports.createUserClient = createUserClient;
//# sourceMappingURL=supabase.js.map
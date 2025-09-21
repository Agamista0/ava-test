"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OpenAIService = void 0;
const openai_1 = __importDefault(require("openai"));
// Initialize OpenAI with error handling for missing API key
let openai = null;
if (process.env.OPENAI_API_KEY) {
    try {
        openai = new openai_1.default({
            apiKey: process.env.OPENAI_API_KEY,
        });
        console.log('✅ OpenAI client initialized successfully');
    }
    catch (error) {
        console.error('❌ Failed to initialize OpenAI client:', error);
        openai = null;
    }
}
else {
    console.warn('⚠️  OPENAI_API_KEY not found, empty, or is a placeholder. AI features will be disabled.');
    console.warn('   Please set a valid OpenAI API key in your environment variables.');
}
class OpenAIService {
    /**
     * Classify a message and get AI response
     */
    static async processMessage(userMessage) {
        try {
            // If OpenAI is not available, use fallback logic
            if (!openai) {
                console.log('Using fallback classification (OpenAI not available)');
                return this.fallbackClassification(userMessage);
            }
            const systemPrompt = `You are an AI assistant for a customer support system. Your job is to:

1. Classify incoming messages as either "inquiry" (general questions, information requests) or "issue" (problems, bugs, complaints that need human intervention)
2. Provide helpful responses for inquiries
3. For issues, provide a brief acknowledgment and indicate that a support ticket will be created

Classification guidelines:
- INQUIRY: Questions about features, how-to guides, general information, account questions, pricing
- ISSUE: Bug reports, technical problems, service outages, billing disputes, feature requests that indicate problems

Respond in JSON format:
{
  "classification": {
    "type": "inquiry" | "issue",
    "confidence": 0.0-1.0,
    "summary": "Brief summary of the issue (for issues only)"
  },
  "response": "Your response to the user"
}`;
            const completion = await openai.chat.completions.create({
                model: "gpt-3.5-turbo",
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userMessage }
                ],
                temperature: 0.3,
                max_tokens: 500
            });
            const response = completion.choices[0]?.message?.content;
            if (!response) {
                throw new Error('No response from OpenAI');
            }
            // Parse the JSON response
            const parsedResponse = JSON.parse(response);
            return {
                message: parsedResponse.response,
                classification: parsedResponse.classification
            };
        }
        catch (error) {
            console.error('OpenAI API error:', error);
            // Fallback to simple classification if OpenAI fails
            return this.fallbackClassification(userMessage);
        }
    }
    /**
     * Fallback classification when OpenAI is not available
     */
    static fallbackClassification(userMessage) {
        const message = userMessage.toLowerCase();
        // Enhanced keyword-based classification
        const issueKeywords = [
            'bug', 'error', 'problem', 'issue', 'broken', 'not working', 'failed', 'crash', 'fix', 'help me fix',
            'login button', 'button doesn\'t work', 'can\'t access', 'preventing me', 'tried multiple browsers',
            'cleared cache', 'persists', 'blocking', 'stuck', 'unable to', 'doesn\'t respond', 'not responding',
            'malfunction', 'glitch', 'defect', 'fault', 'trouble', 'difficulty', 'obstacle', 'barrier'
        ];
        const inquiryKeywords = [
            'how', 'what', 'when', 'where', 'why', 'question', 'help', 'information', 'guide', 'tutorial',
            'account settings', 'business hours', 'contact', 'support', 'pricing', 'features', 'explain',
            'tell me about', 'can you help', 'need help with', 'how do i', 'what is', 'where can i'
        ];
        // Check for issue indicators
        const hasIssueKeywords = issueKeywords.some(keyword => message.includes(keyword));
        const hasInquiryKeywords = inquiryKeywords.some(keyword => message.includes(keyword));
        // Additional context-based detection
        const hasIssueContext = message.includes('experiencing') ||
            message.includes('tried multiple') ||
            message.includes('but the issue') ||
            message.includes('preventing me') ||
            message.includes('doesn\'t work');
        let classification;
        let response;
        // Prioritize issue detection
        if (hasIssueKeywords || hasIssueContext) {
            classification = {
                type: 'issue',
                confidence: 0.8,
                summary: 'User reported a technical issue or problem'
            };
            response = "I understand you're experiencing an issue. I've classified this as a problem that needs attention from our support team. A support ticket will be created for you.";
        }
        else if (hasInquiryKeywords) {
            classification = {
                type: 'inquiry',
                confidence: 0.7
            };
            response = "Thank you for your message. I'm here to help with your inquiry. How can I assist you today?";
        }
        else {
            // Default to inquiry for unclear messages
            classification = {
                type: 'inquiry',
                confidence: 0.5
            };
            response = "Thank you for your message. I'm here to help with your inquiry. How can I assist you today?";
        }
        return {
            message: response,
            classification
        };
    }
    /**
     * Generate a response for general inquiries
     */
    static async generateInquiryResponse(message) {
        try {
            if (!openai) {
                return 'Thank you for your inquiry. Our support team will review your message and get back to you soon.';
            }
            const completion = await openai.chat.completions.create({
                model: "gpt-3.5-turbo",
                messages: [
                    {
                        role: "system",
                        content: "You are a helpful customer support assistant. Provide clear, concise, and helpful responses to user inquiries. Be friendly and professional."
                    },
                    { role: "user", content: message }
                ],
                temperature: 0.7,
                max_tokens: 300
            });
            return completion.choices[0]?.message?.content || 'I apologize, but I cannot process your request at the moment.';
        }
        catch (error) {
            console.error('OpenAI inquiry response error:', error);
            return 'I apologize, but I cannot process your request at the moment. Please try again later.';
        }
    }
    /**
     * Generate a summary for Jira ticket creation
     */
    static async generateTicketSummary(message) {
        try {
            if (!openai) {
                // Simple fallback: take first 50 characters of the message
                return message.length > 50 ? message.substring(0, 47) + '...' : message;
            }
            const completion = await openai.chat.completions.create({
                model: "gpt-3.5-turbo",
                messages: [
                    {
                        role: "system",
                        content: "Generate a concise, clear title/summary for a support ticket based on the user's message. Keep it under 100 characters and focus on the main issue."
                    },
                    { role: "user", content: message }
                ],
                temperature: 0.3,
                max_tokens: 50
            });
            return completion.choices[0]?.message?.content || 'Support Request';
        }
        catch (error) {
            console.error('OpenAI ticket summary error:', error);
            return 'Support Request';
        }
    }
}
exports.OpenAIService = OpenAIService;
//# sourceMappingURL=index.js.map
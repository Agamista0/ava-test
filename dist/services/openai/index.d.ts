export interface MessageClassification {
    type: 'inquiry' | 'issue';
    confidence: number;
    summary?: string;
}
export interface AIResponse {
    message: string;
    classification: MessageClassification;
}
export declare class OpenAIService {
    /**
     * Classify a message and get AI response
     */
    static processMessage(userMessage: string): Promise<AIResponse>;
    /**
     * Fallback classification when OpenAI is not available
     */
    private static fallbackClassification;
    /**
     * Generate a response for general inquiries
     */
    static generateInquiryResponse(message: string): Promise<string>;
    /**
     * Generate a summary for Jira ticket creation
     */
    static generateTicketSummary(message: string): Promise<string>;
}
//# sourceMappingURL=index.d.ts.map
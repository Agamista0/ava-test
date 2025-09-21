export interface Message {
    id: string;
    conversation_id: string;
    sender_id: string;
    message_type: 'text' | 'voice';
    content: string;
    voice_url?: string;
    created_at: string;
}
export interface Conversation {
    id: string;
    user_id: string;
    support_id?: string;
    status: 'open' | 'assigned' | 'closed';
    created_at: string;
    closed_at?: string;
    jira_ticket_id?: string;
}
export declare class ConversationService {
    /**
     * Create a new conversation
     */
    static createConversation(userId: string): Promise<Conversation>;
    /**
     * Get or create conversation for user
     */
    static getOrCreateConversation(userId: string): Promise<Conversation>;
    /**
     * Add a message to a conversation
     */
    static addMessage(conversationId: string, senderId: string, messageType: 'text' | 'voice', content: string, voiceUrl?: string): Promise<Message>;
    /**
     * Get messages for a conversation
     */
    static getMessages(conversationId: string, limit?: number): Promise<Message[]>;
    /**
     * Get conversation by ID
     */
    static getConversation(conversationId: string): Promise<Conversation | null>;
    /**
     * Update conversation with Jira ticket ID
     */
    static updateConversationWithJiraTicket(conversationId: string, jiraTicketId: string): Promise<Conversation>;
    /**
     * Assign conversation to support team member
     */
    static assignConversation(conversationId: string, supportId: string): Promise<Conversation>;
    /**
     * Close conversation
     */
    static closeConversation(conversationId: string): Promise<Conversation>;
    /**
     * Get user's conversations
     */
    static getUserConversations(userId: string): Promise<Conversation[]>;
    /**
     * Get support team's assigned conversations
     */
    static getSupportConversations(supportId: string): Promise<Conversation[]>;
}
//# sourceMappingURL=index.d.ts.map
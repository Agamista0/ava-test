export interface JiraTicket {
    id: string;
    key: string;
    summary: string;
    description: string;
    status: string;
    assignee?: string;
    created: string;
    updated: string;
}
export interface CreateJiraTicketRequest {
    summary: string;
    description: string;
    issueType?: string;
    priority?: string;
    labels?: string[];
}
export declare class JiraService {
    private static baseURL;
    private static username;
    private static apiToken;
    private static projectKey;
    private static getAuthHeader;
    /**
     * Create a new Jira ticket
     */
    static createTicket(request: CreateJiraTicketRequest): Promise<JiraTicket>;
    /**
     * Get ticket details by key
     */
    static getTicket(ticketKey: string): Promise<JiraTicket>;
    /**
     * Update ticket status
     */
    static updateTicketStatus(ticketKey: string, status: string): Promise<void>;
    /**
     * Add comment to ticket
     */
    static addComment(ticketKey: string, comment: string): Promise<void>;
}
//# sourceMappingURL=index.d.ts.map
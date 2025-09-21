"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.JiraService = void 0;
const axios_1 = __importDefault(require("axios"));
class JiraService {
    static getAuthHeader() {
        const credentials = Buffer.from(`${this.username}:${this.apiToken}`).toString('base64');
        return `Basic ${credentials}`;
    }
    /**
     * Create a new Jira ticket
     */
    static async createTicket(request) {
        try {
            if (!this.baseURL || !this.username || !this.apiToken || !this.projectKey) {
                console.warn('⚠️  Jira configuration is incomplete. Creating mock ticket.');
                // Return a mock ticket for testing
                return {
                    id: 'mock-' + Date.now(),
                    key: 'MOCK-' + Math.floor(Math.random() * 1000),
                    summary: request.summary,
                    description: request.description,
                    status: 'To Do',
                    created: new Date().toISOString(),
                    updated: new Date().toISOString()
                };
            }
            const ticketData = {
                fields: {
                    project: {
                        key: this.projectKey
                    },
                    summary: request.summary,
                    description: {
                        type: "doc",
                        version: 1,
                        content: [
                            {
                                type: "paragraph",
                                content: [
                                    {
                                        type: "text",
                                        text: request.description
                                    }
                                ]
                            }
                        ]
                    },
                    issuetype: {
                        name: request.issueType || 'Task'
                    },
                    labels: request.labels || ['chat-support', 'auto-generated']
                }
            };
            const response = await axios_1.default.post(`${this.baseURL}/rest/api/3/issue`, ticketData, {
                headers: {
                    'Authorization': this.getAuthHeader(),
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                }
            });
            const ticket = response.data;
            return {
                id: ticket.id,
                key: ticket.key,
                summary: request.summary,
                description: request.description,
                status: 'To Do',
                created: new Date().toISOString(),
                updated: new Date().toISOString()
            };
        }
        catch (error) {
            console.error('Jira ticket creation error:', error);
            if (axios_1.default.isAxiosError(error)) {
                console.error('Jira API Response:', error.response?.data);
                const errorMessage = error.response?.data?.errorMessages?.join(', ') ||
                    error.response?.data?.errors?.summary ||
                    error.response?.data?.errors?.issuetype ||
                    error.message;
                throw new Error(`Failed to create Jira ticket: ${errorMessage}`);
            }
            throw new Error('Failed to create Jira ticket');
        }
    }
    /**
     * Get ticket details by key
     */
    static async getTicket(ticketKey) {
        try {
            if (!this.baseURL || !this.username || !this.apiToken) {
                throw new Error('Jira configuration is incomplete');
            }
            const response = await axios_1.default.get(`${this.baseURL}/rest/api/3/issue/${ticketKey}`, {
                headers: {
                    'Authorization': this.getAuthHeader(),
                    'Accept': 'application/json'
                }
            });
            const issue = response.data;
            return {
                id: issue.id,
                key: issue.key,
                summary: issue.fields.summary,
                description: issue.fields.description?.content?.[0]?.content?.[0]?.text || '',
                status: issue.fields.status.name,
                assignee: issue.fields.assignee?.displayName,
                created: issue.fields.created,
                updated: issue.fields.updated
            };
        }
        catch (error) {
            console.error('Jira ticket fetch error:', error);
            if (axios_1.default.isAxiosError(error)) {
                const errorMessage = error.response?.data?.errorMessages?.join(', ') ||
                    error.response?.data?.errors?.summary ||
                    error.message;
                throw new Error(`Failed to fetch Jira ticket: ${errorMessage}`);
            }
            throw new Error('Failed to fetch Jira ticket');
        }
    }
    /**
     * Update ticket status
     */
    static async updateTicketStatus(ticketKey, status) {
        try {
            if (!this.baseURL || !this.username || !this.apiToken) {
                throw new Error('Jira configuration is incomplete');
            }
            // First, get available transitions for the ticket
            const transitionsResponse = await axios_1.default.get(`${this.baseURL}/rest/api/3/issue/${ticketKey}/transitions`, {
                headers: {
                    'Authorization': this.getAuthHeader(),
                    'Accept': 'application/json'
                }
            });
            const transitions = transitionsResponse.data.transitions;
            const targetTransition = transitions.find((t) => t.name.toLowerCase() === status.toLowerCase() ||
                t.to.name.toLowerCase() === status.toLowerCase());
            if (!targetTransition) {
                throw new Error(`Cannot transition ticket to status: ${status}`);
            }
            // Perform the transition
            await axios_1.default.post(`${this.baseURL}/rest/api/3/issue/${ticketKey}/transitions`, {
                transition: {
                    id: targetTransition.id
                }
            }, {
                headers: {
                    'Authorization': this.getAuthHeader(),
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                }
            });
        }
        catch (error) {
            console.error('Jira ticket status update error:', error);
            if (axios_1.default.isAxiosError(error)) {
                const errorMessage = error.response?.data?.errorMessages?.join(', ') ||
                    error.response?.data?.errors?.summary ||
                    error.message;
                throw new Error(`Failed to update Jira ticket status: ${errorMessage}`);
            }
            throw new Error('Failed to update Jira ticket status');
        }
    }
    /**
     * Add comment to ticket
     */
    static async addComment(ticketKey, comment) {
        try {
            if (!this.baseURL || !this.username || !this.apiToken) {
                throw new Error('Jira configuration is incomplete');
            }
            await axios_1.default.post(`${this.baseURL}/rest/api/3/issue/${ticketKey}/comment`, {
                body: {
                    type: 'doc',
                    version: 1,
                    content: [
                        {
                            type: 'paragraph',
                            content: [
                                {
                                    type: 'text',
                                    text: comment
                                }
                            ]
                        }
                    ]
                }
            }, {
                headers: {
                    'Authorization': this.getAuthHeader(),
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                }
            });
        }
        catch (error) {
            console.error('Jira comment addition error:', error);
            if (axios_1.default.isAxiosError(error)) {
                const errorMessage = error.response?.data?.errorMessages?.join(', ') ||
                    error.response?.data?.errors?.summary ||
                    error.message;
                throw new Error(`Failed to add comment to Jira ticket: ${errorMessage}`);
            }
            throw new Error('Failed to add comment to Jira ticket');
        }
    }
}
exports.JiraService = JiraService;
JiraService.baseURL = process.env.JIRA_BASE_URL;
JiraService.username = process.env.JIRA_USERNAME;
JiraService.apiToken = process.env.JIRA_API_TOKEN;
JiraService.projectKey = process.env.JIRA_PROJECT_KEY;
//# sourceMappingURL=index.js.map
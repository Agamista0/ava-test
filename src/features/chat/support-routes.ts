import { Router } from 'express'
import { requireAuth, requireRole, AuthenticatedRequest } from '../auth'
import { ConversationService } from '@/services/conversation'
import { JiraService } from '@/services/jira'
import { supabaseAdmin } from '@/lib/supabase'
import {
  supportRateLimit,
  validateMessage,
  validateConversationId,
  validateTicketId,
  validateStatus,
  validatePagination,
  handleValidationErrors
} from '@/middleware/security'

const router = Router()

// Apply support rate limiting to all routes
router.use(supportRateLimit)

// All support routes require support role
router.use(requireAuth)
router.use(requireRole('support'))

// Get all open conversations (for support dashboard)
router.get('/conversations',
  ...validatePagination,
  handleValidationErrors,
  async (req: AuthenticatedRequest, res) => {
  try {
    const { status = 'open' } = req.query
    
    let conversations
    if (status === 'assigned') {
      // Get conversations assigned to this support member
      conversations = await ConversationService.getSupportConversations(req.user!.sub)
    } else {
      // Get all open conversations (this would need a new method in ConversationService)
      // For now, we'll get all conversations and filter
      const { data, error } = await supabaseAdmin
        .from('conversations')
        .select(`
          *,
          profiles!conversations_user_id_fkey(name, avatar_url)
        `)
        .eq('status', status as string)
        .order('created_at', { ascending: false })

      if (error) {
        throw new Error(`Failed to fetch conversations: ${error.message}`)
      }
      conversations = data || []
    }

    res.json({
      conversations: conversations.map(conv => ({
        id: conv.id,
        userId: conv.user_id,
        userName: conv.profiles?.name,
        userAvatar: conv.profiles?.avatar_url,
        status: conv.status,
        createdAt: conv.created_at,
        closedAt: conv.closed_at,
        jiraTicketId: conv.jira_ticket_id,
        supportId: conv.support_id
      }))
    })
  } catch (error) {
    console.error('Get support conversations error:', error)
    res.status(500).json({ error: 'Failed to fetch conversations' })
  }
})

// Assign conversation to support member
router.post('/conversations/:conversationId/assign', async (req: AuthenticatedRequest, res) => {
  try {
    const { conversationId } = req.params
    const supportId = req.user!.sub

    const conversation = await ConversationService.assignConversation(conversationId, supportId)
    
    res.json({
      success: true,
      conversation: {
        id: conversation.id,
        status: conversation.status,
        supportId: conversation.support_id
      }
    })
  } catch (error) {
    console.error('Assign conversation error:', error)
    res.status(500).json({ error: 'Failed to assign conversation' })
  }
})

// Close conversation
router.post('/conversations/:conversationId/close', async (req: AuthenticatedRequest, res) => {
  try {
    const { conversationId } = req.params
    
    const conversation = await ConversationService.closeConversation(conversationId)
    
    res.json({
      success: true,
      conversation: {
        id: conversation.id,
        status: conversation.status,
        closedAt: conversation.closed_at
      }
    })
  } catch (error) {
    console.error('Close conversation error:', error)
    res.status(500).json({ error: 'Failed to close conversation' })
  }
})

// Get Jira ticket details
router.get('/jira-tickets/:ticketId', async (req: AuthenticatedRequest, res) => {
  try {
    const { ticketId } = req.params
    
    const ticket = await JiraService.getTicket(ticketId)
    
    res.json({
      ticket: {
        id: ticket.id,
        key: ticket.key,
        summary: ticket.summary,
        description: ticket.description,
        status: ticket.status,
        assignee: ticket.assignee,
        created: ticket.created,
        updated: ticket.updated
      }
    })
  } catch (error) {
    console.error('Get Jira ticket error:', error)
    res.status(500).json({ error: 'Failed to fetch Jira ticket' })
  }
})

// Update Jira ticket status
router.put('/jira-tickets/:ticketId/status', async (req: AuthenticatedRequest, res) => {
  try {
    const { ticketId } = req.params
    const { status } = req.body

    if (!status) {
      return res.status(400).json({ error: 'Status is required' })
    }

    await JiraService.updateTicketStatus(ticketId, status)
    
    res.json({
      success: true,
      message: `Ticket ${ticketId} status updated to ${status}`
    })
  } catch (error) {
    console.error('Update Jira ticket status error:', error)
    res.status(500).json({ error: 'Failed to update Jira ticket status' })
  }
})

// Add comment to Jira ticket
router.post('/jira-tickets/:ticketId/comments', async (req: AuthenticatedRequest, res) => {
  try {
    const { ticketId } = req.params
    const { comment } = req.body

    if (!comment) {
      return res.status(400).json({ error: 'Comment is required' })
    }

    await JiraService.addComment(ticketId, comment)
    
    res.json({
      success: true,
      message: `Comment added to ticket ${ticketId}`
    })
  } catch (error) {
    console.error('Add Jira comment error:', error)
    res.status(500).json({ error: 'Failed to add comment to Jira ticket' })
  }
})

// Support team can also send messages to conversations
router.post('/conversations/:conversationId/messages', async (req: AuthenticatedRequest, res) => {
  try {
    const { conversationId } = req.params
    const { message } = req.body
    const supportId = req.user!.sub

    if (!message) {
      return res.status(400).json({ error: 'Message is required' })
    }

    // Verify conversation exists and is assigned to this support member
    const conversation = await ConversationService.getConversation(conversationId)
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' })
    }

    if (conversation.support_id !== supportId) {
      return res.status(403).json({ error: 'Conversation not assigned to you' })
    }

    // Add support message
    const supportMessage = await ConversationService.addMessage(
      conversationId,
      supportId,
      'text',
      message
    )

    res.json({
      success: true,
      message: {
        id: supportMessage.id,
        content: supportMessage.content,
        type: supportMessage.message_type,
        senderId: supportMessage.sender_id,
        timestamp: supportMessage.created_at
      }
    })
  } catch (error) {
    console.error('Send support message error:', error)
    res.status(500).json({ error: 'Failed to send message' })
  }
})

export default router

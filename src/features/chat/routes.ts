import { Router, Response } from 'express'
import { requireAuth, AuthenticatedRequest } from '../auth'
import { upload, handleUploadError, validateAudioFile, cleanupTempFiles } from '@/middleware/upload'
import { ConversationService } from '@/services/conversation'
import { OpenAIService } from '@/services/openai'
import { SpeechService } from '@/services/speech'
import { JiraService } from '@/services/jira'
import {
  chatRateLimit,
  validateMessage,
  validateConversationId,
  validatePagination,
  handleValidationErrors,
  validateFileUpload
} from '@/middleware/security'

const router = Router()

// Apply chat rate limiting to all routes
router.use(chatRateLimit)

// Start new conversation endpoint
router.post('/start-conversation',
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user!.sub

      // Create a new conversation
      const conversation = await ConversationService.createConversation(userId)

      res.json({
        success: true,
        conversationId: conversation.id,
        status: conversation.status,
        createdAt: conversation.created_at,
        message: 'New conversation started successfully'
      })
    } catch (error) {
      console.error('Start conversation error:', error)
      res.status(500).json({
        error: 'Failed to start conversation',
        message: 'Please try again later'
      })
    }
  }
)

// Send message endpoint (handles both text and voice)
router.post('/send-message',
  requireAuth,
  upload.single('audio'),
  handleUploadError,
  validateAudioFile,
  validateFileUpload,
  validateMessage,
  handleValidationErrors,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user!.sub
      const { message, conversationId } = req.body
      const audioFile = req.file

      // Validate input
      if (!message && !audioFile) {
        return res.status(400).json({
          error: 'Either text message or audio file is required'
        })
      }

      let conversation

      // If conversationId is provided, use existing conversation
      if (conversationId) {
        conversation = await ConversationService.getConversation(conversationId)
        if (!conversation) {
          return res.status(404).json({ error: 'Conversation not found' })
        }
        if (conversation.user_id !== userId) {
          return res.status(403).json({ error: 'Access denied to this conversation' })
        }
      } else {
        // Get or create conversation
        conversation = await ConversationService.getOrCreateConversation(userId)
      }
      
      let messageText = message
      let messageType: 'text' | 'voice' = 'text'
      let voiceUrl: string | undefined

      // Process voice message if audio file is provided
      if (audioFile) {
        try {
          // Convert audio to text
          messageText = await SpeechService.transcribeAudioFile(audioFile.path);

          messageType = 'voice'
          
          // In a real application, you would upload the audio file to cloud storage
          // and store the URL. For now, we'll just use a placeholder
          voiceUrl = `uploads/${audioFile.filename}`
        } catch (error) {
          console.error('Speech-to-text conversion failed:', error)
          return res.status(400).json({ 
            error: 'Failed to convert audio to text',
            message: 'Please try again or send a text message instead'
          })
        }
      }

      // Add user message to conversation
      const userMessage = await ConversationService.addMessage(
        conversation.id,
        userId,
        messageType,
        messageText,
        voiceUrl
      )

      // Check if conversation is assigned to support
      // If yes, bypass AI processing and send directly to support
      if (conversation.status === 'assigned' && conversation.support_id) {
        return res.json({
          success: true,
          conversationId: conversation.id,
          userMessage: {
            id: userMessage.id,
            content: userMessage.content,
            type: userMessage.message_type,
            timestamp: userMessage.created_at
          },
          message: 'Message sent to support team',
          supportAssigned: true,
          bypassedAI: true
        })
      }

      // Process message with OpenAI (only if not assigned to support)
      let aiResponse: string
      let jiraTicketId: string | undefined

      try {
        const aiResult = await OpenAIService.processMessage(messageText)
        aiResponse = aiResult.message

        // If classified as an issue, create Jira ticket
        if (aiResult.classification.type === 'issue') {
          try {
            const ticketSummary = await OpenAIService.generateTicketSummary(messageText)
            const jiraTicket = await JiraService.createTicket({
              summary: ticketSummary,
              description: `User Message: ${messageText}\n\nConversation ID: ${conversation.id}\nUser ID: ${userId}`,
              issueType: 'Task',
              labels: ['chat-support', 'auto-generated', 'user-issue']
            })

            jiraTicketId = jiraTicket.key

            // Update conversation with Jira ticket ID
            await ConversationService.updateConversationWithJiraTicket(
              conversation.id,
              jiraTicketId
            )

            // Replace AI response with ticket confirmation
            aiResponse = `I understand you're experiencing an issue. I've classified this as a problem that needs attention from our support team. A support ticket has been created for you.\n\nTicket ID: #${jiraTicketId}\n\nOur support team will review your issue and get back to you soon.`
          } catch (jiraError) {
            console.error('Jira ticket creation failed:', jiraError)
            // Keep the original AI response but add fallback message
            aiResponse = `I understand you're experiencing an issue. I've classified this as a problem that needs attention from our support team. While I couldn't create a support ticket automatically, our team will review this conversation and follow up with you.`
          }
        }
      } catch (aiError) {
        console.error('AI processing failed:', aiError)
        aiResponse = 'I apologize, but I\'m having trouble processing your message right now. Please try again or contact our support team directly.'
      }

      // Add AI response to conversation
      // Use a special system UUID for AI responses
      const systemUserId = '590deb5a-2aba-41a1-a8ec-2d52e3fc2fe2'
      const aiMessage = await ConversationService.addMessage(
        conversation.id,
        systemUserId, // System user ID for AI responses
        'text',
        aiResponse
      )

      res.json({
        success: true,
        conversationId: conversation.id,
        isNewConversation: !conversationId,
        conversationStatus: conversation.status,
        userMessage: {
          id: userMessage.id,
          content: userMessage.content,
          type: userMessage.message_type,
          timestamp: userMessage.created_at
        },
        aiResponse: {
          id: aiMessage.id,
          content: aiMessage.content,
          timestamp: aiMessage.created_at
        },
        jiraTicketId,
        supportAssigned: false,
        bypassedAI: false
      })

    } catch (error) {
      console.error('Send message error:', error)
      res.status(500).json({ 
        error: 'Failed to process message',
        message: 'Please try again later'
      })
    }
  },
  cleanupTempFiles
)

// Get conversation messages
router.get('/conversation/:conversationId/messages',
  requireAuth,
  validateConversationId,
  validatePagination,
  handleValidationErrors,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { conversationId } = req.params
      const userId = req.user!.sub

      // Verify user has access to this conversation
      const conversation = await ConversationService.getConversation(conversationId)
      if (!conversation) {
        return res.status(404).json({ error: 'Conversation not found' })
      }

      // Check if user owns the conversation or is assigned support
      if (conversation.user_id !== userId && conversation.support_id !== userId) {
        return res.status(403).json({ error: 'Access denied' })
      }

      const messages = await ConversationService.getMessages(conversationId)
      
      res.json({
        conversationId,
        messages: messages.map(msg => ({
          id: msg.id,
          content: msg.content,
          type: msg.message_type,
          senderId: msg.sender_id,
          timestamp: msg.created_at,
          voiceUrl: msg.voice_url
        }))
      })
    } catch (error) {
      console.error('Get messages error:', error)
      res.status(500).json({ error: 'Failed to fetch messages' })
    }
  }
)

// Get user's conversations
router.get('/conversations',
  requireAuth,
  validatePagination,
  handleValidationErrors,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user!.sub
      const conversations = await ConversationService.getUserConversations(userId)
      
      res.json({
        conversations: conversations.map(conv => ({
          id: conv.id,
          status: conv.status,
          createdAt: conv.created_at,
          closedAt: conv.closed_at,
          jiraTicketId: conv.jira_ticket_id
        }))
      })
    } catch (error) {
      console.error('Get conversations error:', error)
      res.status(500).json({ error: 'Failed to fetch conversations' })
    }
  }
)

// Get current conversation (latest open conversation)
router.get('/current-conversation', 
  requireAuth,
  async (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.user!.sub
      const conversation = await ConversationService.getOrCreateConversation(userId)
      
      res.json({
        conversationId: conversation.id,
        status: conversation.status,
        createdAt: conversation.created_at,
        jiraTicketId: conversation.jira_ticket_id
      })
    } catch (error) {
      console.error('Get current conversation error:', error)
      res.status(500).json({ error: 'Failed to get current conversation' })
    }
  }
)



export default router

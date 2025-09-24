import { Router, Response, Request } from 'express'
import fs from 'fs'
import path from 'path'
import { upload, handleUploadError, validateAudioFile, cleanupTempFiles } from '@/middleware/upload'
import { 
  getSafeFilePathForServing, 
  AUDIO_CONFIG,
  sanitizeFilename,
  constructSafeFilePath 
} from '@/utils/securePathUtils'
import { ConversationService } from '@/services/conversation'
import { OpenAIService } from '@/services/openai'
import { SpeechService } from '@/services/speech'
import { JiraService } from '@/services/jira'
import { supabaseAdmin, createUserClient } from '@/lib/supabase'
import {
  chatRateLimit,
  validateMessage,
  validateConversationId,
  validatePagination,
  handleValidationErrors,
  validateFileUpload
} from '@/middleware/security'

// Interface for authenticated request
interface AuthenticatedRequest extends Request {
  user?: any
}

const router = Router()

// Authentication helper for chat routes
const requireSupabaseAuth = async (req: any, res: any, next: any) => {
  try {
    const authHeader = req.headers.authorization
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authorization token required' })
    }

    const token = authHeader.split(' ')[1]
    
    // Verify the user is authenticated using Supabase
    const userClient = createUserClient(token)
    const { data: { user }, error: authError } = await userClient.auth.getUser()
    
    if (authError || !user) {
      return res.status(401).json({ error: 'Invalid authentication token' })
    }

    // Add user to request object
    req.user = user
    next()
  } catch (error) {
    console.error('Authentication error:', error)
    res.status(401).json({ error: 'Authentication failed' })
  }
}

// Apply chat rate limiting to all routes
router.use(chatRateLimit)

// Serve audio files
router.get('/audio/:filename', (req: Request, res: Response) => {
  try {
    const filename = req.params.filename;
    
    // Use secure path utilities to get a safe file path
    const safeFilePath = getSafeFilePathForServing(
      AUDIO_CONFIG.baseDirectory,
      filename,
      AUDIO_CONFIG.allowedExtensions
    );
    
    // Set appropriate headers for audio files
    const ext = path.extname(filename).toLowerCase();
    let mimeType = 'audio/mpeg'; // default
    
    switch (ext) {
      case '.mp3':
        mimeType = 'audio/mpeg';
        break;
      case '.wav':
        mimeType = 'audio/wav';
        break;
      case '.m4a':
        mimeType = 'audio/mp4';
        break;
      case '.ogg':
        mimeType = 'audio/ogg';
        break;
      case '.flac':
        mimeType = 'audio/flac';
        break;
    }
    
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'private, no-cache');
    
    // Send the file using the validated safe path
    res.sendFile(safeFilePath);
  } catch (error) {
    console.error('Error serving audio file:', error);
    
    // Return appropriate error based on the error message
    if (error instanceof Error) {
      if (error.message.includes('Invalid filename') || 
          error.message.includes('path traversal') ||
          error.message.includes('invalid characters')) {
        return res.status(400).json({ error: 'Invalid filename' });
      }
      if (error.message.includes('File not found')) {
        return res.status(404).json({ error: 'Audio file not found' });
      }
      if (error.message.includes('File extension not allowed')) {
        return res.status(400).json({ error: 'File type not supported' });
      }
    }
    
    res.status(500).json({ error: 'Failed to serve audio file' });
  }
});

// Start new conversation endpoint
router.post('/start-conversation',
  requireSupabaseAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user!.id

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
  requireSupabaseAuth,
  upload.single('audio'),
  handleUploadError,
  validateAudioFile,
  validateFileUpload,
  validateMessage,
  handleValidationErrors,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user!.id
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
          // Log detailed file information
          console.log('📁 Uploaded audio file info:', {
            originalname: audioFile.originalname,
            mimetype: audioFile.mimetype,
            size: audioFile.size,
            destination: audioFile.destination,
            filename: audioFile.filename,
            path: audioFile.path
          })

          // Check if file has content
          if (audioFile.size === 0) {
            console.error('❌ Uploaded audio file is empty!')
            return res.status(400).json({ 
              error: 'Uploaded audio file is empty. Please try recording again.' 
            })
          }

          // Check if file exists at the path (validate that the upload was successful)
          // Note: audioFile.path is controlled by multer middleware, not user input
          // but we still validate it exists and is accessible
          if (!fs.existsSync(audioFile.path)) {
            console.error('❌ Audio file not found at path:', audioFile.path)
            return res.status(400).json({ 
              error: 'Audio file not found. Please try uploading again.' 
            })
          }

          // Check file stats
          const fileStats = fs.statSync(audioFile.path)
          console.log('📊 File stats:', {
            size: fileStats.size,
            isFile: fileStats.isFile(),
            modified: fileStats.mtime
          })

          if (fileStats.size === 0) {
            console.error('❌ Audio file on disk is empty!')
            return res.status(400).json({ 
              error: 'Audio file appears to be empty. Please try recording again.' 
            })
          }

          console.log('✅ Audio file validation passed, proceeding with transcription...')

          // Convert audio to text
          messageText = await SpeechService.transcribeAudioFile(audioFile.path);

          messageType = 'voice'
          
          // Create audio storage directory if it doesn't exist
          const audioDir = AUDIO_CONFIG.baseDirectory;
          if (!fs.existsSync(audioDir)) {
            fs.mkdirSync(audioDir, { recursive: true });
          }
          
          // Generate unique filename for the audio file
          const timestamp = Date.now();
          const randomId = Math.random().toString(36).substring(2, 11);
          const fileExtension = path.extname(audioFile.originalname) || '.mp3';
          
          // Sanitize the generated filename
          const permanentFileName = sanitizeFilename(`audio_${timestamp}_${randomId}${fileExtension}`);
          
          // Use secure path construction
          const permanentFilePath = constructSafeFilePath(audioDir, permanentFileName);
          
          // Copy the uploaded file to permanent storage
          fs.copyFileSync(audioFile.path, permanentFilePath);
          
          // Create URL for accessing the audio file
          voiceUrl = `/uploads/audio/${permanentFileName}`;
          
          console.log(`🎵 Audio file saved: ${permanentFilePath}`);
          console.log(`🔗 Audio URL: ${voiceUrl}`);
          
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
  requireSupabaseAuth,
  validateConversationId,
  validatePagination,
  handleValidationErrors,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { conversationId } = req.params
      const userId = req.user!.id

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
  requireSupabaseAuth,
  validatePagination,
  handleValidationErrors,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user!.id
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
  requireSupabaseAuth,
  async (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.user!.id
      const conversation = await ConversationService.getOrCreateConversation(userId)
      
      // Get messages for this conversation
      const messages = await ConversationService.getMessages(conversation.id)
      
      res.json({
        conversationId: conversation.id,
        status: conversation.status,
        createdAt: conversation.created_at,
        jiraTicketId: conversation.jira_ticket_id,
        messages: messages.map(msg => ({
          id: msg.id,
          senderId: msg.sender_id,
          senderName: msg.profiles?.name || 'User',
          senderRole: msg.profiles?.role || 'user',
          content: msg.content,
          type: msg.message_type,
          voiceUrl: msg.voice_url,
          timestamp: msg.created_at
        }))
      })
    } catch (error) {
      console.error('Get current conversation error:', error)
      res.status(500).json({ error: 'Failed to get current conversation' })
    }
  }
)



export default router

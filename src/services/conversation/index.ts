import { supabaseAdmin } from '@/lib/supabase'
import { v4 as uuidv4 } from 'uuid'

export interface Message {
  id: string
  conversation_id: string
  sender_id: string
  message_type: 'text' | 'voice'
  content: string
  voice_url?: string
  created_at: string
}

export interface Conversation {
  id: string
  user_id: string
  support_id?: string
  status: 'open' | 'assigned' | 'closed'
  created_at: string
  closed_at?: string
  jira_ticket_id?: string
}

export class ConversationService {
  /**
   * Create a new conversation
   */
  static async createConversation(userId: string): Promise<Conversation> {
    try {
      const { data, error } = await supabaseAdmin
        .from('conversations')
        .insert({
          id: uuidv4(),
          user_id: userId,
          status: 'open'
        })
        .select()
        .single()

      if (error) {
        throw new Error(`Failed to create conversation: ${error.message}`)
      }

      return data
    } catch (error) {
      console.error('Conversation creation error:', error)
      throw new Error('Failed to create conversation')
    }
  }

  /**
   * Get or create conversation for user
   */
  static async getOrCreateConversation(userId: string): Promise<Conversation> {
    try {
      // First, try to find an open conversation
      const { data: existingConversation, error: fetchError } = await supabaseAdmin
        .from('conversations')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'open')
        .order('created_at', { ascending: false })
        .limit(1)
        .single()

      if (existingConversation && !fetchError) {
        return existingConversation
      }

      // If no open conversation exists, create a new one
      return await this.createConversation(userId)
    } catch (error) {
      console.error('Get or create conversation error:', error)
      throw new Error('Failed to get or create conversation')
    }
  }

  /**
   * Add a message to a conversation
   */
  static async addMessage(
    conversationId: string,
    senderId: string,
    messageType: 'text' | 'voice',
    content: string,
    voiceUrl?: string
  ): Promise<Message> {
    try {
      // Ensure system user exists in profiles table
      if (senderId === '00000000-0000-0000-0000-000000000000') {
        await supabaseAdmin
          .from('profiles')
          .upsert({
            id: senderId,
            role: 'user',
            name: 'AI Assistant',
            avatar_url: null
          })
      }

      const { data, error } = await supabaseAdmin
        .from('messages')
        .insert({
          id: uuidv4(),
          conversation_id: conversationId,
          sender_id: senderId,
          message_type: messageType,
          content,
          voice_url: voiceUrl
        })
        .select()
        .single()

      if (error) {
        throw new Error(`Failed to add message: ${error.message}`)
      }

      return data
    } catch (error) {
      console.error('Add message error:', error)
      throw new Error('Failed to add message')
    }
  }

  /**
   * Get messages for a conversation
   */
  static async getMessages(conversationId: string, limit: number = 50): Promise<Message[]> {
    try {
      const { data, error } = await supabaseAdmin
        .from('messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true })
        .limit(limit)

      if (error) {
        throw new Error(`Failed to fetch messages: ${error.message}`)
      }

      return data || []
    } catch (error) {
      console.error('Get messages error:', error)
      throw new Error('Failed to fetch messages')
    }
  }

  /**
   * Get conversation by ID
   */
  static async getConversation(conversationId: string): Promise<Conversation | null> {
    try {
      const { data, error } = await supabaseAdmin
        .from('conversations')
        .select('*')
        .eq('id', conversationId)
        .single()

      if (error) {
        if (error.code === 'PGRST116') {
          return null // Conversation not found
        }
        throw new Error(`Failed to fetch conversation: ${error.message}`)
      }

      return data
    } catch (error) {
      console.error('Get conversation error:', error)
      throw new Error('Failed to fetch conversation')
    }
  }

  /**
   * Update conversation with Jira ticket ID
   */
  static async updateConversationWithJiraTicket(
    conversationId: string,
    jiraTicketId: string
  ): Promise<Conversation> {
    try {
      const { data, error } = await supabaseAdmin
        .from('conversations')
        .update({ jira_ticket_id: jiraTicketId })
        .eq('id', conversationId)
        .select()
        .single()

      if (error) {
        throw new Error(`Failed to update conversation: ${error.message}`)
      }

      return data
    } catch (error) {
      console.error('Update conversation error:', error)
      throw new Error('Failed to update conversation')
    }
  }

  /**
   * Assign conversation to support team member
   */
  static async assignConversation(
    conversationId: string,
    supportId: string
  ): Promise<Conversation> {
    try {
      const { data, error } = await supabaseAdmin
        .from('conversations')
        .update({
          support_id: supportId,
          status: 'assigned'
        })
        .eq('id', conversationId)
        .select()
        .single()

      if (error) {
        throw new Error(`Failed to assign conversation: ${error.message}`)
      }

      return data
    } catch (error) {
      console.error('Assign conversation error:', error)
      throw new Error('Failed to assign conversation')
    }
  }

  /**
   * Close conversation
   */
  static async closeConversation(conversationId: string): Promise<Conversation> {
    try {
      const { data, error } = await supabaseAdmin
        .from('conversations')
        .update({
          status: 'closed',
          closed_at: new Date().toISOString()
        })
        .eq('id', conversationId)
        .select()
        .single()

      if (error) {
        throw new Error(`Failed to close conversation: ${error.message}`)
      }

      return data
    } catch (error) {
      console.error('Close conversation error:', error)
      throw new Error('Failed to close conversation')
    }
  }

  /**
   * Get user's conversations
   */
  static async getUserConversations(userId: string): Promise<Conversation[]> {
    try {
      const { data, error } = await supabaseAdmin
        .from('conversations')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })

      if (error) {
        throw new Error(`Failed to fetch user conversations: ${error.message}`)
      }

      return data || []
    } catch (error) {
      console.error('Get user conversations error:', error)
      throw new Error('Failed to fetch user conversations')
    }
  }

  /**
   * Get support team's assigned conversations
   */
  static async getSupportConversations(supportId: string): Promise<Conversation[]> {
    try {
      const { data, error } = await supabaseAdmin
        .from('conversations')
        .select('*')
        .eq('support_id', supportId)
        .order('created_at', { ascending: false })

      if (error) {
        throw new Error(`Failed to fetch support conversations: ${error.message}`)
      }

      return data || []
    } catch (error) {
      console.error('Get support conversations error:', error)
      throw new Error('Failed to fetch support conversations')
    }
  }
}

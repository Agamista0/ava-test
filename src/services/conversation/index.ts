import { supabaseAdmin } from '@/lib/supabase'
import { v4 as uuidv4 } from 'uuid'

export interface Message {
  id: string
  conversation_id: string
  sender_id: string
  message_type: 'text' | 'voice' | 'file' | 'system'
  content: string
  voice_url?: string
  file_url?: string
  file_name?: string
  file_size?: number
  is_edited?: boolean
  edited_at?: string
  created_at: string
  metadata?: any
  profiles?: {
    name: string
    avatar_url?: string
    role: string
  }
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

      // Build insert object conditionally to handle missing columns gracefully
      const insertData: any = {
        id: uuidv4(),
        conversation_id: conversationId,
        sender_id: senderId,
        message_type: messageType,
        content
      }

      // Only include voice_url if provided
      if (voiceUrl) {
        insertData.voice_url = voiceUrl
      }

      const { data, error } = await supabaseAdmin
        .from('messages')
        .insert(insertData)
        .select()
        .single()

      if (error) {
        // If voice_url column doesn't exist, try again without it
        if (error.message.includes('voice_url') && voiceUrl) {
          console.warn('⚠️ voice_url column not found, retrying without voice_url')
          const fallbackData = { ...insertData }
          delete fallbackData.voice_url
          
          const { data: retryData, error: retryError } = await supabaseAdmin
            .from('messages')
            .insert(fallbackData)
            .select()
            .single()
          
          if (retryError) {
            throw new Error(`Failed to add message: ${retryError.message}`)
          }
          
          console.log('✅ Message added successfully without voice_url')
          return retryData
        }
        
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
      // First, get all messages
      const { data: messages, error } = await supabaseAdmin
        .from('messages')
        .select(`
          id,
          conversation_id,
          sender_id,
          message_type,
          content,
          voice_url,
          created_at,
          metadata
        `)
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true })
        .limit(limit)

      if (error) {
        throw new Error(`Failed to fetch messages: ${error.message}`)
      }

      if (!messages || messages.length === 0) {
        return []
      }

      // Get unique sender IDs
      const senderIds = [...new Set(messages.map(msg => msg.sender_id))]
      
      // Fetch profile data for all senders
      const { data: profiles, error: profileError } = await supabaseAdmin
        .from('profiles')
        .select('id, name, avatar_url, role')
        .in('id', senderIds)

      if (profileError) {
        console.warn('Failed to fetch profiles, using fallback names:', profileError.message)
      }

      // Create a profile lookup map
      const profileMap = new Map()
      if (profiles) {
        profiles.forEach(profile => {
          profileMap.set(profile.id, profile)
        })
      }

      // Transform the data to match our Message interface
      const transformedMessages: Message[] = messages.map((item: any) => {
        const profile = profileMap.get(item.sender_id)
        return {
          id: item.id,
          conversation_id: item.conversation_id,
          sender_id: item.sender_id,
          message_type: item.message_type,
          content: item.content,
          voice_url: item.voice_url,
          file_url: undefined, // Not available in current schema
          file_name: undefined, // Not available in current schema
          file_size: undefined, // Not available in current schema
          is_edited: false, // Default value since column doesn't exist
          edited_at: undefined, // Not available in current schema
          created_at: item.created_at,
          metadata: item.metadata,
          profiles: profile ? {
            name: profile.name || 'User',
            avatar_url: profile.avatar_url,
            role: profile.role || 'user'
          } : {
            name: 'User',
            avatar_url: null,
            role: 'user'
          }
        }
      })

      return transformedMessages
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

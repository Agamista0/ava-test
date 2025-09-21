#!/usr/bin/env node

/**
 * Script to create the system user profile for AI responses
 * This fixes the "null value in column email" error
 */

const { supabaseAdmin } = require('../dist/lib/supabase.js')

async function createSystemUser() {
  console.log('🔧 Creating system user profile for AI responses...')
  
  try {
    // Check if system user already exists
    const { data: existingUser, error: checkError } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', '00000000-0000-0000-0000-000000000000')
      .single()

    if (existingUser) {
      console.log('✅ System user already exists:', existingUser)
      return
    }

    if (checkError && checkError.code !== 'PGRST116') {
      console.error('❌ Error checking for existing system user:', checkError)
      return
    }

    // Create the system user profile
    const { data, error } = await supabaseAdmin
      .from('profiles')
      .insert({
        id: '00000000-0000-0000-0000-000000000000',
        email: 'ai-assistant@system.local',
        name: 'AI Assistant',
        role: 'user',
        is_active: true
      })
      .select()

    if (error) {
      console.error('❌ Error creating system user:', error)
      return
    }

    console.log('✅ System user created successfully:', data)

    // Create index for better performance
    const { error: indexError } = await supabaseAdmin.rpc('create_index_if_not_exists', {
      table_name: 'messages',
      index_name: 'idx_messages_sender_id',
      column_name: 'sender_id'
    })

    if (indexError) {
      console.log('⚠️  Index creation failed (may already exist):', indexError.message)
    } else {
      console.log('✅ Index created for messages.sender_id')
    }

  } catch (error) {
    console.error('❌ Unexpected error:', error)
  }
}

// Run the script
createSystemUser()
  .then(() => {
    console.log('🎉 System user setup complete!')
    process.exit(0)
  })
  .catch((error) => {
    console.error('💥 Script failed:', error)
    process.exit(1)
  })

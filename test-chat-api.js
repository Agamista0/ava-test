const axios = require('axios')
const FormData = require('form-data')
const fs = require('fs')

// Test the chat API with a text message
async function testChatAPI() {
  try {
    console.log('🧪 Testing chat API...')
    
    // First get a test token (you'll need to replace this with a real token)
    const testToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test' // Placeholder
    
    // Test health endpoint first
    console.log('1. Testing health endpoint...')
    const healthResponse = await axios.get('http://localhost:3000/health')
    console.log('✅ Health check:', healthResponse.data)
    
    // Test current conversation endpoint
    console.log('2. Testing current conversation...')
    try {
      const conversationResponse = await axios.get('http://localhost:3000/api/chat/current-conversation', {
        headers: {
          'Authorization': `Bearer ${testToken}`,
          'Content-Type': 'application/json'
        }
      })
      console.log('✅ Current conversation:', conversationResponse.data)
    } catch (error) {
      if (error.response?.status === 401) {
        console.log('ℹ️ Expected 401 - need valid token for conversation endpoint')
      } else {
        console.error('❌ Conversation error:', error.response?.data || error.message)
      }
    }
    
    console.log('3. Basic server connectivity test completed')
    
  } catch (error) {
    console.error('❌ Test failed:', error.message)
  }
}

testChatAPI()
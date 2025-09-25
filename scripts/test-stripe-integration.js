const axios = require('axios')
require('dotenv').config()

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000'

// Test data
const testUser = {
  email: 'test@example.com',
  password: 'TestPassword123!',
  name: 'Test User'
}

let authToken = ''
let userId = ''

async function makeRequest(method, endpoint, data = null, headers = {}) {
  try {
    const config = {
      method,
      url: `${BASE_URL}${endpoint}`,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
    }

    if (data) {
      config.data = data
    }

    const response = await axios(config)
    return response.data
  } catch (error) {
    if (error.response) {
      throw new Error(`${error.response.status}: ${JSON.stringify(error.response.data)}`)
    }
    throw error
  }
}

async function authenticatedRequest(method, endpoint, data = null) {
  return makeRequest(method, endpoint, data, {
    Authorization: `Bearer ${authToken}`,
  })
}

async function testHealthCheck() {
  console.log('🏥 Testing health check...')
  const response = await makeRequest('GET', '/health')
  console.log('✅ Health check passed:', response.status)
}

async function testSubscriptionPlans() {
  console.log('\n📋 Testing subscription plans...')
  const response = await makeRequest('GET', '/api/subscriptions/plans')
  
  if (response.success && response.data.length > 0) {
    console.log('✅ Subscription plans fetched successfully')
    console.log(`   Found ${response.data.length} plans:`)
    response.data.forEach(plan => {
      console.log(`   - ${plan.display_name}: $${plan.price_amount / 100}/month (${plan.credits_included} credits)`)
    })
    return response.data
  } else {
    throw new Error('No subscription plans found')
  }
}

async function testUserRegistration() {
  console.log('\n👤 Testing user registration...')
  try {
    const response = await makeRequest('POST', '/api/auth/register', {
      email: testUser.email,
      password: testUser.password,
      name: testUser.name,
    })

    if (response.success) {
      console.log('✅ User registration successful')
      authToken = response.tokens.accessToken
      userId = response.user.id
      return response
    } else {
      throw new Error('Registration failed')
    }
  } catch (error) {
    if (error.message.includes('already exists')) {
      console.log('ℹ️  User already exists, attempting login...')
      return testUserLogin()
    }
    throw error
  }
}

async function testUserLogin() {
  console.log('\n🔐 Testing user login...')
  const response = await makeRequest('POST', '/api/auth/login', {
    email: testUser.email,
    password: testUser.password,
  })

  if (response.success) {
    console.log('✅ User login successful')
    authToken = response.tokens.accessToken
    userId = response.user.id
    return response
  } else {
    throw new Error('Login failed')
  }
}

async function testCurrentSubscription() {
  console.log('\n📊 Testing current subscription status...')
  const response = await authenticatedRequest('GET', '/api/subscriptions/current')
  
  if (response.success) {
    console.log('✅ Current subscription fetched successfully')
    if (response.data.subscription) {
      console.log(`   Subscription: ${response.data.subscription.status}`)
    } else {
      console.log('   No active subscription')
    }
    
    if (response.data.credits) {
      console.log(`   Credits: ${response.data.credits.current_credits}/${response.data.credits.total_credits_allocated}`)
    }
    return response.data
  } else {
    throw new Error('Failed to fetch current subscription')
  }
}

async function testCreateSubscription(plans) {
  console.log('\n💳 Testing subscription creation...')
  
  // Use the first (cheapest) plan for testing
  const testPlan = plans[0]
  
  try {
    const response = await authenticatedRequest('POST', '/api/subscriptions/create-subscription', {
      priceId: testPlan.stripe_price_id,
    })

    if (response.success) {
      console.log('✅ Subscription creation initiated successfully')
      console.log(`   Plan: ${response.data.plan.name}`)
      console.log(`   Credits: ${response.data.plan.credits}`)
      console.log(`   Price: $${response.data.plan.price}`)
      
      if (response.data.clientSecret) {
        console.log('   Client secret received for payment confirmation')
      }
      
      return response.data
    } else {
      throw new Error('Subscription creation failed')
    }
  } catch (error) {
    if (error.message.includes('already has an active subscription')) {
      console.log('ℹ️  User already has an active subscription')
      return null
    }
    throw error
  }
}

async function testCreditsUsage() {
  console.log('\n🎯 Testing credits usage...')
  
  try {
    const response = await authenticatedRequest('POST', '/api/subscriptions/use-credits', {
      credits: 1,
      actionType: 'chat_message',
      description: 'Test credit usage',
    })

    if (response.success) {
      console.log('✅ Credits used successfully')
      console.log(`   Remaining credits: ${response.remainingCredits}`)
      return response
    } else {
      throw new Error('Credits usage failed')
    }
  } catch (error) {
    if (error.message.includes('Insufficient credits')) {
      console.log('ℹ️  User has insufficient credits')
      return null
    }
    throw error
  }
}

async function testWebhookEndpoint() {
  console.log('\n🔗 Testing webhook endpoint...')
  
  try {
    // This will fail without proper signature, but we can test if the endpoint exists
    const response = await makeRequest('POST', '/api/webhook/stripe', {
      type: 'test',
      data: { object: {} },
    })
    
    console.log('⚠️  Webhook endpoint responded (this should normally fail without signature)')
  } catch (error) {
    if (error.message.includes('Missing Stripe signature')) {
      console.log('✅ Webhook endpoint is properly secured (requires signature)')
    } else {
      console.log('⚠️  Unexpected webhook response:', error.message)
    }
  }
}

async function runIntegrationTests() {
  console.log('🧪 Ava Mobile App - Stripe Integration Tests')
  console.log('==============================================')

  try {
    // Test basic functionality
    await testHealthCheck()
    
    // Test subscription plans
    const plans = await testSubscriptionPlans()
    
    // Test user authentication
    await testUserRegistration()
    
    // Test subscription functionality
    await testCurrentSubscription()
    await testCreateSubscription(plans)
    await testCurrentSubscription() // Check again after creation
    
    // Test credits functionality
    await testCreditsUsage()
    
    // Test webhook endpoint
    await testWebhookEndpoint()
    
    console.log('\n🎉 All integration tests completed successfully!')
    console.log('\n📝 Next steps:')
    console.log('   1. Set up real Stripe products using: npm run setup-stripe')
    console.log('   2. Configure webhook endpoint in Stripe Dashboard')
    console.log('   3. Test with real payment methods')
    console.log('   4. Monitor webhook events and subscription lifecycle')

  } catch (error) {
    console.error('\n❌ Integration test failed:', error.message)
    process.exit(1)
  }
}

// Run tests if this script is executed directly
if (require.main === module) {
  runIntegrationTests()
}

module.exports = {
  runIntegrationTests,
  testHealthCheck,
  testSubscriptionPlans,
  testUserRegistration,
  testCurrentSubscription,
  testCreateSubscription,
  testCreditsUsage,
}

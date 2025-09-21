#!/usr/bin/env node

/**
 * Simple test script to verify the backend API is working
 * Run with: node test-api.js
 */

const BASE_URL = 'http://localhost:3000';

async function testAPI() {
  console.log('🧪 Testing Ava Backend API...\n');

  // Test 1: Health check
  try {
    console.log('1. Testing health check...');
    const response = await fetch(`${BASE_URL}/health`);
    const data = await response.json();
    
    if (response.ok) {
      console.log('   ✅ Health check passed');
      console.log(`   📊 Status: ${data.status}, Environment: ${data.environment}\n`);
    } else {
      console.log('   ❌ Health check failed');
      return;
    }
  } catch (error) {
    console.log('   ❌ Cannot connect to backend server');
    console.log('   💡 Make sure the backend is running with: npm run dev\n');
    return;
  }

  // Test 2: Sign up
  console.log('2. Testing user signup...');
  const testUser = {
    email: `test${Date.now()}@example.com`,
    password: 'testpass123',
    fullName: 'Test User'
  };

  try {
    const response = await fetch(`${BASE_URL}/api/auth/signup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(testUser),
    });

    const data = await response.json();
    
    if (response.ok) {
      console.log('   ✅ User signup successful');
      console.log(`   👤 User: ${data.user.email}\n`);
    } else {
      console.log('   ❌ User signup failed');
      console.log(`   🔍 Error: ${data.error}\n`);
    }
  } catch (error) {
    console.log('   ❌ Signup request failed');
    console.log(`   🔍 Error: ${error.message}\n`);
  }

  // Test 3: Sign in
  console.log('3. Testing user signin...');
  try {
    const response = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: testUser.email,
        password: testUser.password,
      }),
    });

    const data = await response.json();
    
    if (response.ok) {
      console.log('   ✅ User signin successful');
      console.log(`   🔑 Access token received\n`);
      
      // Test authenticated endpoint
      await testAuthenticatedEndpoint(data.session.access_token);
    } else {
      console.log('   ❌ User signin failed');
      console.log(`   🔍 Error: ${data.error}\n`);
    }
  } catch (error) {
    console.log('   ❌ Signin request failed');
    console.log(`   🔍 Error: ${error.message}\n`);
  }

  console.log('🎉 API testing completed!');
  console.log('\n💡 If you see errors, check:');
  console.log('   - Backend server is running (npm run dev)');
  console.log('   - Supabase environment variables are configured');
  console.log('   - Database schema has been applied');
}

async function testAuthenticatedEndpoint(token) {
  console.log('4. Testing authenticated endpoint...');
  try {
    const response = await fetch(`${BASE_URL}/api/auth/me`, {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });

    const data = await response.json();
    
    if (response.ok) {
      console.log('   ✅ Authenticated request successful');
      console.log(`   👤 Profile: ${data.profile.full_name}\n`);
    } else {
      console.log('   ❌ Authenticated request failed');
      console.log(`   🔍 Error: ${data.error}\n`);
    }
  } catch (error) {
    console.log('   ❌ Authenticated request failed');
    console.log(`   🔍 Error: ${error.message}\n`);
  }
}

// Run the tests
testAPI();
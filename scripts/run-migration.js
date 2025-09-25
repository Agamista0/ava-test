const { createClient } = require('@supabase/supabase-js')
const fs = require('fs')
const path = require('path')
require('dotenv').config()

async function runMigration() {
  console.log('🔄 Running Stripe subscription migration...')

  // Create Supabase client with service role key
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  )

  try {
    // Read the migration file
    const migrationPath = path.join(__dirname, '..', 'migrations', 'stripe_subscriptions_schema.sql')
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8')

    // Split the migration into individual statements
    const statements = migrationSQL
      .split(';')
      .map(stmt => stmt.trim())
      .filter(stmt => stmt.length > 0 && !stmt.startsWith('--'))

    console.log(`📝 Found ${statements.length} SQL statements to execute`)

    // Execute each statement
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i] + ';'
      
      // Skip comments and empty statements
      if (statement.trim().startsWith('--') || statement.trim() === ';') {
        continue
      }

      console.log(`⚡ Executing statement ${i + 1}/${statements.length}...`)
      
      try {
        const { error } = await supabase.rpc('exec_sql', { sql: statement })
        
        if (error) {
          // Check if it's a "relation already exists" error, which we can ignore
          if (error.message.includes('already exists') || 
              error.message.includes('duplicate key value violates unique constraint')) {
            console.log(`⚠️  Statement ${i + 1} skipped (already exists): ${error.message}`)
            continue
          }
          throw error
        }
        
        console.log(`✅ Statement ${i + 1} executed successfully`)
      } catch (statementError) {
        console.error(`❌ Error executing statement ${i + 1}:`, statementError.message)
        console.log(`Statement: ${statement.substring(0, 100)}...`)
        
        // Continue with other statements unless it's a critical error
        if (!statementError.message.includes('already exists')) {
          throw statementError
        }
      }
    }

    console.log('✅ Migration completed successfully!')

    // Verify the tables were created
    console.log('\n🔍 Verifying tables...')
    
    const tables = [
      'subscription_plans',
      'user_subscriptions', 
      'user_credits',
      'credits_usage_history',
      'stripe_webhook_events'
    ]

    for (const table of tables) {
      const { data, error } = await supabase
        .from(table)
        .select('*')
        .limit(1)

      if (error) {
        console.log(`❌ Table ${table} verification failed:`, error.message)
      } else {
        console.log(`✅ Table ${table} exists and is accessible`)
      }
    }

    // Check if subscription plans were inserted
    const { data: plans, error: plansError } = await supabase
      .from('subscription_plans')
      .select('plan_name, display_name, price_amount')

    if (plansError) {
      console.log('❌ Error fetching subscription plans:', plansError.message)
    } else {
      console.log('\n📋 Subscription plans:')
      plans.forEach(plan => {
        console.log(`  - ${plan.display_name}: $${plan.price_amount / 100}`)
      })
    }

  } catch (error) {
    console.error('❌ Migration failed:', error.message)
    process.exit(1)
  }
}

// Alternative method using Supabase client directly
async function runMigrationDirect() {
  console.log('🔄 Running migration with Supabase client...')

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  )

  try {
    // Check if subscription_plans table exists by trying to query it
    console.log('📝 Checking if subscription_plans table exists...')

    const { data: existingPlans, error: checkError } = await supabase
      .from('subscription_plans')
      .select('id')
      .limit(1)

    if (checkError && checkError.message.includes('relation "public.subscription_plans" does not exist')) {
      console.log('❌ subscription_plans table does not exist. Please create it manually in Supabase dashboard.')
      console.log('📋 SQL to create the table:')
      console.log(`
CREATE TABLE subscription_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_product_id TEXT UNIQUE NOT NULL,
  stripe_price_id TEXT UNIQUE NOT NULL,
  plan_name TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  description TEXT,
  price_amount INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'usd',
  billing_interval TEXT NOT NULL DEFAULT 'month',
  credits_included INTEGER NOT NULL DEFAULT 0,
  features JSONB DEFAULT '{}',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
      `)
      return
    }

    console.log('✅ subscription_plans table exists')

    // Insert subscription plans
    console.log('📝 Inserting subscription plans...')
    
    const { error: insertError } = await supabase
      .from('subscription_plans')
      .upsert([
        {
          stripe_product_id: 'prod_starting_placeholder',
          stripe_price_id: 'price_starting_placeholder',
          plan_name: 'starting',
          display_name: 'Starting Plan',
          description: 'Perfect for getting started with AI assistance',
          price_amount: 999,
          currency: 'usd',
          billing_interval: 'month',
          credits_included: 80,
          features: {
            ai_chat_support: 'basic',
            email_support: true,
            response_time: 'standard',
            voice_messages: false,
            priority_support: false,
            custom_integrations: false
          }
        },
        {
          stripe_product_id: 'prod_scaling_placeholder',
          stripe_price_id: 'price_scaling_placeholder',
          plan_name: 'scaling',
          display_name: 'Scaling Plan',
          description: 'Advanced features for growing businesses',
          price_amount: 1999,
          currency: 'usd',
          billing_interval: 'month',
          credits_included: 160,
          features: {
            ai_chat_support: 'advanced',
            email_support: 'priority',
            response_time: 'faster',
            voice_messages: true,
            priority_support: false,
            custom_integrations: false
          }
        },
        {
          stripe_product_id: 'prod_summit_placeholder',
          stripe_price_id: 'price_summit_placeholder',
          plan_name: 'summit',
          display_name: 'Summit Plan',
          description: 'Premium experience with all features included',
          price_amount: 3999,
          currency: 'usd',
          billing_interval: 'month',
          credits_included: 400,
          features: {
            ai_chat_support: 'premium',
            email_support: '24/7_priority',
            response_time: 'instant',
            voice_messages: true,
            priority_support: true,
            custom_integrations: true
          }
        }
      ], { 
        onConflict: 'stripe_product_id',
        ignoreDuplicates: true 
      })

    if (insertError) {
      console.log('⚠️  Plans insert warning:', insertError.message)
    } else {
      console.log('✅ Subscription plans inserted successfully')
    }

    console.log('✅ Migration completed successfully!')

  } catch (error) {
    console.error('❌ Direct migration failed:', error.message)
    process.exit(1)
  }
}

// Run the migration
if (require.main === module) {
  runMigrationDirect()
    .catch(error => {
      console.error('Migration failed:', error)
      process.exit(1)
    })
}

module.exports = { runMigration, runMigrationDirect }

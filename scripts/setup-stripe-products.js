const Stripe = require('stripe')
const { createClient } = require('@supabase/supabase-js')
require('dotenv').config()

// Initialize Stripe
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-12-18.acacia',
})

// Initialize Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

const SUBSCRIPTION_PLANS = [
  {
    name: 'starting',
    displayName: 'Starting Plan',
    description: 'Perfect for getting started with AI assistance',
    price: 999, // $9.99 in cents
    credits: 80,
    features: {
      ai_chat_support: 'basic',
      email_support: true,
      response_time: 'standard',
      voice_messages: false,
      priority_support: false,
      custom_integrations: false,
    },
  },
  {
    name: 'scaling',
    displayName: 'Scaling Plan',
    description: 'Advanced features for growing businesses',
    price: 1999, // $19.99 in cents
    credits: 160,
    features: {
      ai_chat_support: 'advanced',
      email_support: 'priority',
      response_time: 'faster',
      voice_messages: true,
      priority_support: false,
      custom_integrations: false,
    },
  },
  {
    name: 'summit',
    displayName: 'Summit Plan',
    description: 'Premium experience with all features included',
    price: 3999, // $39.99 in cents
    credits: 400,
    features: {
      ai_chat_support: 'premium',
      email_support: '24/7_priority',
      response_time: 'instant',
      voice_messages: true,
      priority_support: true,
      custom_integrations: true,
    },
  },
]

async function createStripeProducts() {
  console.log('🚀 Setting up Stripe products and prices...')

  for (const plan of SUBSCRIPTION_PLANS) {
    try {
      console.log(`\n📦 Creating product for ${plan.displayName}...`)

      // Create product in Stripe
      const product = await stripe.products.create({
        name: plan.displayName,
        description: plan.description,
        metadata: {
          plan_name: plan.name,
          credits_included: plan.credits.toString(),
          features: JSON.stringify(plan.features),
        },
      })

      console.log(`✅ Product created: ${product.id}`)

      // Create price for the product
      console.log(`💰 Creating price for ${plan.displayName}...`)
      const price = await stripe.prices.create({
        product: product.id,
        unit_amount: plan.price,
        currency: 'usd',
        recurring: {
          interval: 'month',
        },
        metadata: {
          plan_name: plan.name,
          credits_included: plan.credits.toString(),
        },
      })

      console.log(`✅ Price created: ${price.id}`)

      // Update the subscription plan in the database
      console.log(`🗄️  Updating database for ${plan.displayName}...`)
      const { error } = await supabase
        .from('subscription_plans')
        .update({
          stripe_product_id: product.id,
          stripe_price_id: price.id,
        })
        .eq('plan_name', plan.name)

      if (error) {
        console.error(`❌ Failed to update database for ${plan.name}:`, error)
      } else {
        console.log(`✅ Database updated for ${plan.displayName}`)
      }

      console.log(`🎉 Successfully set up ${plan.displayName}`)
      console.log(`   Product ID: ${product.id}`)
      console.log(`   Price ID: ${price.id}`)
      console.log(`   Amount: $${plan.price / 100}/month`)
      console.log(`   Credits: ${plan.credits}`)

    } catch (error) {
      console.error(`❌ Error setting up ${plan.displayName}:`, error.message)
    }
  }
}

async function verifySetup() {
  console.log('\n🔍 Verifying setup...')

  try {
    // Check database
    const { data: plans, error } = await supabase
      .from('subscription_plans')
      .select('*')
      .eq('is_active', true)

    if (error) {
      console.error('❌ Failed to fetch plans from database:', error)
      return
    }

    console.log(`\n📊 Found ${plans.length} active plans in database:`)
    for (const plan of plans) {
      console.log(`   ${plan.display_name}:`)
      console.log(`     Product ID: ${plan.stripe_product_id}`)
      console.log(`     Price ID: ${plan.stripe_price_id}`)
      console.log(`     Credits: ${plan.credits_included}`)
      console.log(`     Price: $${plan.price_amount / 100}/month`)
    }

    // Verify Stripe products
    console.log('\n🔍 Verifying Stripe products...')
    for (const plan of plans) {
      try {
        const product = await stripe.products.retrieve(plan.stripe_product_id)
        const price = await stripe.prices.retrieve(plan.stripe_price_id)
        
        console.log(`✅ ${plan.display_name}: Product and price verified in Stripe`)
      } catch (stripeError) {
        console.error(`❌ ${plan.display_name}: Stripe verification failed:`, stripeError.message)
      }
    }

  } catch (error) {
    console.error('❌ Verification failed:', error)
  }
}

async function main() {
  try {
    console.log('🎯 Ava Mobile App - Stripe Setup Script')
    console.log('=====================================')

    // Check environment variables
    if (!process.env.STRIPE_SECRET_KEY) {
      console.error('❌ STRIPE_SECRET_KEY environment variable is required')
      process.exit(1)
    }

    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
      console.error('❌ Supabase environment variables are required')
      process.exit(1)
    }

    console.log('✅ Environment variables verified')

    // Create products and prices
    await createStripeProducts()

    // Verify setup
    await verifySetup()

    console.log('\n🎉 Stripe setup completed successfully!')
    console.log('\n📝 Next steps:')
    console.log('   1. Update your webhook endpoint in Stripe Dashboard')
    console.log('   2. Add your webhook secret to STRIPE_WEBHOOK_SECRET environment variable')
    console.log('   3. Test the subscription flow')

  } catch (error) {
    console.error('❌ Setup failed:', error)
    process.exit(1)
  }
}

// Run the script
if (require.main === module) {
  main()
}

module.exports = {
  createStripeProducts,
  verifySetup,
  SUBSCRIPTION_PLANS,
}

const { createClient } = require('@supabase/supabase-js')

const supabaseUrl = 'https://stfkvmxeiazybaithlzk.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN0Zmt2bXhlaWF6eWJhaXRobHprIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODE0MjI4MCwiZXhwIjoyMDczNzE4MjgwfQ.jehhAFg_rlhkuWYUCbkCrzzYE94L2DGlMETRqEC0ko4'

const supabase = createClient(supabaseUrl, supabaseKey)

async function checkAndAddColumn() {
  try {
    console.log('Checking if attachments column exists...')
    
    // Try to select from support_requests to see current structure
    const { data, error } = await supabase
      .from('support_requests')
      .select('*')
      .limit(1)
    
    if (error) {
      console.error('Error querying support_requests:', error)
      return
    }
    
    console.log('Current support_requests structure:', data && data[0] ? Object.keys(data[0]) : 'No data')
    
    // Check if attachments column exists
    if (data && data[0] && data[0].hasOwnProperty('attachments')) {
      console.log('✅ Attachments column already exists!')
    } else {
      console.log('⚠️ Attachments column does not exist.')
      console.log('Please run this SQL manually in your Supabase dashboard:')
      console.log('\nSQL to run:')
      console.log('ALTER TABLE support_requests ADD COLUMN attachments JSONB DEFAULT \'[]\'::jsonb;')
      console.log('CREATE INDEX idx_support_requests_attachments ON support_requests USING gin (attachments);')
    }
    
  } catch (error) {
    console.error('Script error:', error)
  }
}

checkAndAddColumn()
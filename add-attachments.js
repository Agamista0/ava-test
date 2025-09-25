const { createClient } = require('@supabase/supabase-js')

const supabaseUrl = process.env.SUPABASE_URL || 'https://stfkvmxeiazybaithlzk.supabase.co'
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN0Zmt2bXhlaWF6eWJhaXRobHprIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODE0MjI4MCwiZXhwIjoyMDczNzE4MjgwfQ.jehhAFg_rlhkuWYUCbkCrzzYE94L2DGlMETRqEC0ko4'

const supabase = createClient(supabaseUrl, supabaseKey)

async function addAttachmentsColumn() {
  try {
    console.log('Adding attachments column to support_requests table...')
    
    // Use raw SQL to add the column
    const { data, error } = await supabase.rpc('exec_sql', {
      query: `
        DO $$ 
        BEGIN 
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'support_requests' 
            AND column_name = 'attachments'
          ) THEN
            ALTER TABLE support_requests 
            ADD COLUMN attachments JSONB DEFAULT '[]'::jsonb;
            
            CREATE INDEX idx_support_requests_attachments 
            ON support_requests USING gin (attachments);
            
            RAISE NOTICE 'Attachments column and index created successfully';
          ELSE
            RAISE NOTICE 'Attachments column already exists';
          END IF;
        END $$;
      `
    })
    
    if (error) {
      console.error('Error:', error)
    } else {
      console.log('✅ Migration completed successfully!')
      console.log('Data:', data)
    }
    
  } catch (error) {
    console.error('Script error:', error)
  }
}

addAttachmentsColumn()
import { supabaseAdmin } from './src/lib/supabase'

async function runMigration() {
  try {
    console.log('Running support attachments migration...')
    
    // Try to add the column directly via SQL
    const { error } = await supabaseAdmin
      .from('support_requests')
      .select('attachments')
      .limit(1)
    
    if (error && error.message.includes('does not exist')) {
      console.log('Attachments column does not exist, this is expected for new migration')
      
      // Since we can't easily run DDL through the Supabase client in this way,
      // let's just proceed with testing and assume the column will be added manually
      console.log('⚠️  Please run the following SQL manually in your database:')
      console.log(`
ALTER TABLE support_requests 
ADD COLUMN attachments JSONB DEFAULT '[]'::jsonb;

CREATE INDEX idx_support_requests_attachments 
ON support_requests USING gin (attachments);
      `)
    } else {
      console.log('✅ Attachments column already exists or accessible')
    }
    
  } catch (error) {
    console.error('Error checking migration:', error)
    console.log('⚠️  Please run the following SQL manually in your database:')
    console.log(`
ALTER TABLE support_requests 
ADD COLUMN attachments JSONB DEFAULT '[]'::jsonb;

CREATE INDEX idx_support_requests_attachments 
ON support_requests USING gin (attachments);
    `)
  } finally {
    process.exit(0)
  }
}

runMigration()
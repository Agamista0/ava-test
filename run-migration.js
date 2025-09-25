import { supabaseAdmin } from './src/lib/supabase.js'

async function runMigration() {
  try {
    console.log('Running support attachments migration...')
    
    // Add attachments column to support_requests table
    const { error: alterTableError } = await supabaseAdmin.rpc('exec_sql', {
      sql: `
        ALTER TABLE support_requests 
        ADD COLUMN IF NOT EXISTS attachments JSONB DEFAULT '[]'::jsonb;
        
        -- Add a comment to document the expected structure
        COMMENT ON COLUMN support_requests.attachments IS 'Array of attachment objects with fields: {filename: string, original_name: string, mime_type: string, size: number, url: string}';
      `
    })

    if (alterTableError) {
      console.error('Error running migration:', alterTableError)
      return
    }

    // Add index for querying attachments
    const { error: indexError } = await supabaseAdmin.rpc('exec_sql', {
      sql: `CREATE INDEX IF NOT EXISTS idx_support_requests_attachments ON support_requests USING gin (attachments);`
    })

    if (indexError) {
      console.error('Error creating index:', indexError)
      return
    }

    console.log('✅ Migration completed successfully!')
    
  } catch (error) {
    console.error('Migration failed:', error)
  } finally {
    process.exit(0)
  }
}

runMigration()
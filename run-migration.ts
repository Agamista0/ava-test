import { supabaseAdmin } from './src/lib/supabase'

async function runMigration() {
  try {
    console.log('Running support attachments migration...')
    
    // First, let's check if the column already exists
    const { data: columns, error: checkError } = await supabaseAdmin
      .rpc('exec_sql', { 
        sql: `
          SELECT column_name 
          FROM information_schema.columns 
          WHERE table_name = 'support_requests' 
          AND column_name = 'attachments'
        `
      })

    if (checkError) {
      console.error('Error checking existing columns:', checkError)
      return
    }

    if (columns && columns.length > 0) {
      console.log('✅ Attachments column already exists, skipping migration')
      return
    }

    // Add attachments column to support_requests table
    const { error: alterError } = await supabaseAdmin
      .rpc('exec_sql', {
        sql: `ALTER TABLE support_requests ADD COLUMN attachments JSONB DEFAULT '[]'::jsonb;`
      })

    if (alterError) {
      console.error('Error adding attachments column:', alterError)
      return
    }

    console.log('✅ Added attachments column')

    // Add index for querying attachments
    const { error: indexError } = await supabaseAdmin
      .rpc('exec_sql', {
        sql: `CREATE INDEX idx_support_requests_attachments ON support_requests USING gin (attachments);`
      })

    if (indexError) {
      console.error('Error creating index:', indexError)
      return
    }

    console.log('✅ Created attachments index')
    console.log('✅ Migration completed successfully!')
    
  } catch (error) {
    console.error('Migration failed:', error)
  } finally {
    process.exit(0)
  }
}

runMigration()
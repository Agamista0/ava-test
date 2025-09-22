const { createClient } = require('@supabase/supabase-js')
const fs = require('fs')
const path = require('path')

// Supabase configuration
const supabaseUrl = process.env.SUPABASE_URL || 'https://pjrmqevrmhifgkgihtnw.supabase.co'
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseServiceKey) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY is required')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function runMigration() {
  try {
    console.log('🔧 Running voice_url column migration...')
    
    // Read the migration SQL file
    const migrationPath = path.join(__dirname, 'add-voice-url-column.sql')
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8')
    
    // Execute the migration
    const { error } = await supabase.rpc('exec', { sql: migrationSQL })
    
    if (error) {
      console.error('❌ Migration failed:', error)
      process.exit(1)
    }
    
    console.log('✅ Voice URL column migration completed successfully')
    
    // Verify the column exists
    const { data: columns, error: checkError } = await supabase
      .from('information_schema.columns')
      .select('column_name')
      .eq('table_name', 'messages')
      .eq('column_name', 'voice_url')
    
    if (checkError) {
      console.warn('⚠️ Could not verify column existence:', checkError)
    } else if (columns && columns.length > 0) {
      console.log('✅ Verified: voice_url column exists in messages table')
    } else {
      console.log('⚠️ voice_url column not found - may need manual verification')
    }
    
  } catch (error) {
    console.error('❌ Migration script error:', error)
    process.exit(1)
  }
}

// Run the migration
runMigration()
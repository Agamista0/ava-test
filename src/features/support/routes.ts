import { Router } from 'express'
import { z } from 'zod'
import { createUserClient, supabaseAdmin } from '../../lib/supabase'
const router = Router()

// Debug endpoint to verify routes are working
router.get('/debug', (req, res) => {
  res.json({ 
    message: 'Support routes are working!',
    timestamp: new Date().toISOString(),
    availableRoutes: [
      'GET /api/support/debug',
      'POST /api/support/requests',
      'GET /api/support/requests',
      'POST /api/support/validate-code',
      'POST /api/support/generate-code',
      'GET /api/support/codes',
      'POST /api/support/deactivate-code'
    ]
  })
})

// Validation schemas
const validateSupportCodeSchema = z.object({
  supportCode: z.string().min(1, 'Support code is required'),
})

const generateSupportCodeSchema = z.object({
  description: z.string().optional(),
  expiresAt: z.string().optional(),
  maxUses: z.number().min(1).optional(),
})

const createSupportRequestSchema = z.object({
  category: z.enum(['marketing', 'scheduling', 'content', 'social', 'administrative', 'other']).optional(),
  title: z.string().min(5, 'Title must be at least 5 characters').max(100, 'Title cannot exceed 100 characters'),
  description: z.string().min(20, 'Description must be at least 20 characters').max(1000, 'Description cannot exceed 1000 characters'),
  priority: z.enum(['low', 'medium', 'high']).optional(),
})

// Create support request endpoint
router.post('/requests', async (req, res) => {
  try {
    console.log('POST /api/support/requests - Request received')
    console.log('Headers:', req.headers)
    console.log('Body:', req.body)
    
    const authHeader = req.headers.authorization
    if (!authHeader?.startsWith('Bearer ')) {
      console.log('No authorization header found')
      return res.status(401).json({ error: 'Authorization token required' })
    }

    const token = authHeader.split(' ')[1]
    console.log('Token received:', token.substring(0, 20) + '...')
    
    // Verify the user is authenticated
    const userClient = createUserClient(token)
    const { data: { user }, error: authError } = await userClient.auth.getUser()
    
    if (authError || !user) {
      console.log('Auth error:', authError)
      return res.status(401).json({ error: 'Invalid authentication token' })
    }

    console.log('User authenticated:', user.id)

    // Log the raw request body for debugging
    console.log('Raw request body:', JSON.stringify(req.body, null, 2))
    
    // Validate request data
    try {
      const requestData = createSupportRequestSchema.parse(req.body)
      console.log('Request data validated:', requestData)

      // Create the support request using admin client
      const { data, error } = await supabaseAdmin
        .from('support_requests')
        .insert({
          user_id: user.id,
          category: requestData.category,
          title: requestData.title,
          description: requestData.description,
          priority: requestData.priority,
          status: 'pending'
        })
        .select('*')
        .single()

      if (error) {
        console.error('Database error:', error)
        return res.status(500).json({ 
          error: 'Failed to create support request' 
        })
      }

      console.log('Support request created successfully:', data.id)
      res.status(201).json({
        message: 'Support request created successfully',
        request: data
      })
    } catch (validationError) {
      console.error('Validation error details:', validationError)
      
      if (validationError instanceof z.ZodError) {
        return res.status(400).json({ 
          error: 'Invalid request data',
          details: validationError.errors.map(err => ({
            field: err.path.join('.'),
            message: err.message
          }))
        })
      }
      
      // Re-throw non-validation errors to be caught by outer catch
      throw validationError
    }
  } catch (error) {
    console.error('Create request error:', error)
    
    res.status(500).json({ 
      error: 'Internal server error' 
    })
  }
})

// Get support requests for the authenticated user
router.get('/requests', async (req, res) => {
  try {
    const authHeader = req.headers.authorization
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authorization token required' })
    }

    const token = authHeader.split(' ')[1]
    
    // Verify the user is authenticated
    const userClient = createUserClient(token)
    const { data: { user }, error: authError } = await userClient.auth.getUser()
    
    if (authError || !user) {
      return res.status(401).json({ error: 'Invalid authentication token' })
    }

    // Get user's support requests using admin client
    const { data, error } = await supabaseAdmin
      .from('support_requests')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Database error:', error)
      return res.status(500).json({ 
        error: 'Failed to fetch support requests' 
      })
    }

    res.json({
      requests: data
    })
  } catch (error) {
    console.error('Fetch requests error:', error)
    res.status(500).json({ 
      error: 'Internal server error' 
    })
  }
})

// Validate support code endpoint
router.post('/validate-code', async (req, res) => {
  try {
    const { supportCode } = validateSupportCodeSchema.parse(req.body)

    // Call the database function to validate the support code
    const { data, error } = await supabaseAdmin.rpc('validate_support_code', {
      p_support_code: supportCode
    })

    if (error) {
      console.error('Database error:', error)
      return res.status(500).json({ 
        error: 'Failed to validate support code' 
      })
    }

    if (!data) {
      return res.status(400).json({ 
        error: 'Invalid or expired support code' 
      })
    }

    res.json({ 
      valid: true, 
      message: 'Support code is valid' 
    })
  } catch (error) {
    console.error('Validation error:', error)
    
    if (error instanceof z.ZodError) {
      return res.status(400).json({ 
        error: 'Invalid request data',
        details: error.errors 
      })
    }

    res.status(500).json({ 
      error: 'Internal server error' 
    })
  }
})

// Generate support code endpoint (requires support user authentication)
router.post('/generate-code', async (req, res) => {
  try {
    const authHeader = req.headers.authorization
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authorization token required' })
    }

    const token = authHeader.split(' ')[1]
    
    // Verify the user is authenticated and is a support user
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token)
    
    if (authError || !user) {
      return res.status(401).json({ error: 'Invalid authentication token' })
    }

    // Check if user is support type
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('user_type')
      .eq('id', user.id)
      .single()

    if (profileError || profile?.user_type !== 'support') {
      return res.status(403).json({ error: 'Access denied: Support users only' })
    }

    const { description, expiresAt, maxUses } = generateSupportCodeSchema.parse(req.body)

    // Generate a new support code
    const { data, error } = await supabaseAdmin.rpc('generate_support_code', {
      p_created_by: user.id,
      p_description: description || null,
      p_expires_at: expiresAt || null,
      p_max_uses: maxUses || null
    })

    if (error) {
      console.error('Database error:', error)
      return res.status(500).json({ 
        error: 'Failed to generate support code' 
      })
    }

    res.json({ 
      code: data,
      message: 'Support code generated successfully' 
    })
  } catch (error) {
    console.error('Generation error:', error)
    
    if (error instanceof z.ZodError) {
      return res.status(400).json({ 
        error: 'Invalid request data',
        details: error.errors 
      })
    }

    res.status(500).json({ 
      error: 'Internal server error' 
    })
  }
})

// Get support codes endpoint (requires support user authentication)
router.get('/codes', async (req, res) => {
  try {
    const authHeader = req.headers.authorization
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authorization token required' })
    }

    const token = authHeader.split(' ')[1]
    
    // Verify the user is authenticated and is a support user
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token)

    if (authError || !user) {
      return res.status(401).json({ error: 'Invalid authentication token' })
    }

    // Check if user is support type
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('user_type')
      .eq('id', user.id)
      .single()

    if (profileError || profile?.user_type !== 'support') {
      return res.status(403).json({ error: 'Access denied: Support users only' })
    }

    // Get all support codes
    const { data, error } = await supabaseAdmin.rpc('get_support_codes')

    if (error) {
      console.error('Database error:', error)
      return res.status(500).json({ 
        error: 'Failed to fetch support codes' 
      })
    }

    res.json({ codes: data })
  } catch (error) {
    console.error('Fetch error:', error)
    res.status(500).json({ 
      error: 'Internal server error' 
    })
  }
})

// Deactivate support code endpoint
router.post('/deactivate-code', async (req, res) => {
  try {
    const authHeader = req.headers.authorization
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authorization token required' })
    }

    const token = authHeader.split(' ')[1]
    
    // Verify the user is authenticated and is a support user
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token)

    if (authError || !user) {
      return res.status(401).json({ error: 'Invalid authentication token' })
    }

    // Check if user is support type
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('user_type')
      .eq('id', user.id)
      .single()

    if (profileError || profile?.user_type !== 'support') {
      return res.status(403).json({ error: 'Access denied: Support users only' })
    }

    const { supportCode } = z.object({
      supportCode: z.string().min(1, 'Support code is required')
    }).parse(req.body)

    // Deactivate the support code
    const { error } = await supabaseAdmin.rpc('deactivate_support_code', {
      p_support_code: supportCode
    })

    if (error) {
      console.error('Database error:', error)
      return res.status(500).json({ 
        error: 'Failed to deactivate support code' 
      })
    }

    res.json({ 
      message: 'Support code deactivated successfully' 
    })
  } catch (error) {
    console.error('Deactivation error:', error)
    
    if (error instanceof z.ZodError) {
      return res.status(400).json({ 
        error: 'Invalid request data',
        details: error.errors 
      })
    }

    res.status(500).json({ 
      error: 'Internal server error' 
    })
  }
})

export { router as supportRoutes }
export default router
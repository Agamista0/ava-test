import multer from 'multer'
import path from 'path'
import fs from 'fs'

// Ensure support upload directory exists
const supportUploadDir = path.join(process.env.UPLOAD_DIR || 'uploads', 'support')
if (!fs.existsSync(supportUploadDir)) {
  fs.mkdirSync(supportUploadDir, { recursive: true })
}

// Configure multer for support attachment uploads
const supportStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, supportUploadDir)
  },
  filename: (req, file, cb) => {
    // Generate unique filename with timestamp
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9)
    const extension = path.extname(file.originalname)
    const sanitizedName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_')
    cb(null, `support-${uniqueSuffix}-${sanitizedName}`)
  }
})

// File filter for support attachments
const supportFileFilter = (req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const allowedMimeTypes = [
    // Documents
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
    'text/csv',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    // Images
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/gif',
    'image/webp',
    // Archives (optional)
    'application/zip',
    'application/x-zip-compressed'
  ]

  if (allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true)
  } else {
    cb(new Error(`Invalid file type. Allowed types: PDF, DOC, DOCX, TXT, CSV, XLS, XLSX, JPG, PNG, GIF, WebP, ZIP`))
  }
}

// Create multer instance for support attachments
export const supportUpload = multer({
  storage: supportStorage,
  fileFilter: supportFileFilter,
  limits: {
    fileSize: parseInt(process.env.MAX_ATTACHMENT_SIZE || '10485760'), // 10MB default
    files: 5 // Allow up to 5 files
  }
})

// Middleware to handle support upload errors
export const handleSupportUploadError = (error: any, req: any, res: any, next: any) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        error: 'File too large',
        message: `Maximum file size is ${parseInt(process.env.MAX_ATTACHMENT_SIZE || '10485760') / 1024 / 1024}MB`
      })
    }
    if (error.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({
        error: 'Too many files',
        message: 'Maximum 5 files are allowed per request'
      })
    }
  }
  
  if (error.message.includes('Invalid file type')) {
    return res.status(400).json({
      error: 'Invalid file type',
      message: error.message
    })
  }

  next(error)
}

// Middleware to process uploaded support files
export const processSupportFiles = (req: any, res: any, next: any) => {
  if (!req.files || req.files.length === 0) {
    return next()
  }

  // Process files and create attachment metadata
  const attachments = req.files.map((file: Express.Multer.File) => ({
    filename: file.filename,
    original_name: file.originalname,
    mime_type: file.mimetype,
    size: file.size,
    url: `/uploads/support/${file.filename}`
  }))

  // Add attachments to request body
  req.body.attachments = attachments
  next()
}

// Cleanup function for failed uploads
export const cleanupSupportFiles = (files: Express.Multer.File[]) => {
  files.forEach(file => {
    try {
      fs.unlinkSync(file.path)
    } catch (error) {
      console.error('Error cleaning up file:', file.path, error)
    }
  })
}
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import { SpeechService } from '@/services/speech'

// Ensure upload directory exists
const uploadDir = process.env.UPLOAD_DIR || 'uploads'
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true })
}

// Configure multer for audio file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir)
  },
  filename: (req, file, cb) => {
    // Generate unique filename with timestamp
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9)
    const extension = path.extname(file.originalname)
    cb(null, `audio-${uniqueSuffix}${extension}`)
  }
})

// File filter for audio files - updated for @xenova/transformers compatibility
const fileFilter = (req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const allowedMimeTypes = [
    'audio/webm',
    'audio/mp3',
    'audio/wav',
    'audio/x-wav',
    'audio/wave',
    'audio/x-pn-wav',
    'audio/flac',
    'audio/ogg',
    'audio/mpeg',
    'audio/mp4',
    'audio/m4a',
    'audio/aac'
  ]

  if (allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true)
  } else {
    cb(new Error(`Invalid file type. Allowed types: ${allowedMimeTypes.join(', ')}`))
  }
}

// Create multer instance
export const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE || '10485760'), // 10MB default
    files: 1 // Only allow one file at a time
  }
})

// Middleware to handle file upload errors
export const handleUploadError = (error: any, req: any, res: any, next: any) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        error: 'File too large',
        message: `Maximum file size is ${parseInt(process.env.MAX_FILE_SIZE || '10485760') / 1024 / 1024}MB`
      })
    }
    if (error.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({
        error: 'Too many files',
        message: 'Only one file is allowed per request'
      })
    }
    if (error.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({
        error: 'Unexpected file field',
        message: 'File must be uploaded in the "audio" field'
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

// Middleware to validate uploaded audio file
export const validateAudioFile = (req: any, res: any, next: any) => {
  if (!req.file) {
    return next()
  }

  const validation = SpeechService.validateAudioFile(req.file)
  if (!validation.valid) {
    // Clean up the uploaded file
    fs.unlinkSync(req.file.path)
    return res.status(400).json({
      error: 'Invalid audio file',
      message: validation.error
    })
  }

  next()
}

// Cleanup middleware to remove temporary files
export const cleanupTempFiles = (req: any, res: any, next: any) => {
  const originalSend = res.send
  
  res.send = function(data: any) {
    // Clean up uploaded file after response is sent
    if (req.file && req.file.path) {
      try {
        fs.unlinkSync(req.file.path)
      } catch (error) {
        console.error('Failed to cleanup temp file:', error)
      }
    }
    
    return originalSend.call(this, data)
  }
  
  next()
}

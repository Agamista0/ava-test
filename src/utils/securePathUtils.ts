import { join, resolve, basename, extname, normalize } from 'path'
import { existsSync } from 'fs'

/**
 * Secure path utilities to prevent path traversal vulnerabilities
 * These utilities ensure that file paths are properly validated and sanitized
 */

/**
 * Sanitizes a filename by removing dangerous characters and patterns
 * @param filename - The filename to sanitize
 * @returns Sanitized filename
 */
export function sanitizeFilename(filename: string): string {
  if (!filename || typeof filename !== 'string') {
    throw new Error('Invalid filename provided')
  }

  // Remove null bytes and all control characters (0x00-0x1f and 0x80-0x9f)
  let cleanName = filename.replace(/[\x00-\x1f\x80-\x9f]/g, '')
  
  // Only allow alphanumeric characters, dashes, underscores, periods, and spaces
  const allowedChars = /^[a-zA-Z0-9._\-\s]+$/
  
  if (!allowedChars.test(cleanName)) {
    throw new Error('Filename contains invalid characters')
  }

  // Remove any path traversal attempts
  if (cleanName.includes('..') || cleanName.includes('/') || cleanName.includes('\\')) {
    throw new Error('Filename contains path traversal characters')
  }

  // Ensure filename is not empty after sanitization
  const trimmed = cleanName.trim()
  if (!trimmed) {
    throw new Error('Filename is empty after sanitization')
  }

  // Limit filename length
  if (trimmed.length > 255) {
    throw new Error('Filename is too long')
  }

  return trimmed
}

/**
 * Validates that a file extension is in the allowed list
 * @param filename - The filename to check
 * @param allowedExtensions - Array of allowed extensions (e.g., ['.mp3', '.wav'])
 * @returns True if extension is allowed
 */
export function validateFileExtension(filename: string, allowedExtensions: string[]): boolean {
  const ext = extname(filename).toLowerCase()
  return allowedExtensions.includes(ext)
}

/**
 * Constructs a safe file path within a base directory
 * @param baseDir - The base directory that files must be within
 * @param filename - The filename to append
 * @returns Safe absolute file path
 */
export function constructSafeFilePath(baseDir: string, filename: string): string {
  // Sanitize the filename first
  const safeFilename = sanitizeFilename(filename)
  
  // Normalize and resolve the base directory to prevent tampering
  const normalizedBaseDir = normalize(resolve(baseDir))
  
  // Construct the full path
  const fullPath = resolve(normalizedBaseDir, safeFilename)
  
  // Ensure the resulting path is still within the base directory
  // On Windows, we need to handle both forward and backward slashes
  const baseDirWithSeparator = normalizedBaseDir + (normalizedBaseDir.endsWith('\\') || normalizedBaseDir.endsWith('/') ? '' : require('path').sep)
  
  if (!fullPath.startsWith(baseDirWithSeparator) && fullPath !== normalizedBaseDir) {
    throw new Error('Path traversal attempt detected')
  }

  return fullPath
}

/**
 * Validates that a path is within the allowed base directory
 * @param filePath - The file path to validate
 * @param baseDir - The base directory that the path must be within
 * @returns True if path is safe
 */
export function validatePathWithinBase(filePath: string, baseDir: string): boolean {
  try {
    const normalizedBase = normalize(resolve(baseDir))
    const normalizedPath = normalize(resolve(filePath))
    
    return normalizedPath.startsWith(normalizedBase + '/') || normalizedPath === normalizedBase
  } catch (error) {
    return false
  }
}

/**
 * Safely checks if a file exists within a base directory
 * @param baseDir - The base directory
 * @param filename - The filename to check
 * @returns True if file exists and is within base directory
 */
export function safeFileExists(baseDir: string, filename: string): boolean {
  try {
    const safePath = constructSafeFilePath(baseDir, filename)
    return existsSync(safePath)
  } catch (error) {
    return false
  }
}

/**
 * Gets a safe file path for serving with validation
 * @param baseDir - The base directory for file serving
 * @param filename - The requested filename
 * @param allowedExtensions - Optional array of allowed file extensions
 * @returns Safe file path for serving
 */
export function getSafeFilePathForServing(
  baseDir: string, 
  filename: string, 
  allowedExtensions?: string[]
): string {
  // Construct safe path
  const safePath = constructSafeFilePath(baseDir, filename)
  
  // Validate file extension if provided
  if (allowedExtensions && !validateFileExtension(filename, allowedExtensions)) {
    throw new Error('File extension not allowed')
  }
  
  // Check if file exists
  if (!existsSync(safePath)) {
    throw new Error('File not found')
  }
  
  return safePath
}

/**
 * Configuration for audio file serving
 */
export const AUDIO_CONFIG = {
  allowedExtensions: ['.mp3', '.wav', '.m4a', '.ogg', '.flac'] as string[],
  maxFileSize: 50 * 1024 * 1024, // 50MB
  baseDirectory: join(process.cwd(), 'uploads', 'audio')
}

/**
 * Configuration for general file uploads
 */
export const UPLOAD_CONFIG = {
  baseDirectory: join(process.cwd(), 'uploads'),
  maxFileSize: 100 * 1024 * 1024, // 100MB
} as const
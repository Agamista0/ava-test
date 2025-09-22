import speakeasy from 'speakeasy'
import QRCode from 'qrcode'
import { supabaseAdmin } from '@/lib'
import crypto from 'crypto'

export interface TwoFASecret {
  secret: string
  qrCodeUrl: string
  backupCodes: string[]
}

export interface TwoFAConfig {
  userId: string
  secret: string
  isEnabled: boolean
  enabledAt: string | null
  backupCodes?: string[]
}

export class TwoFAService {
  private static readonly APP_NAME = 'Ava'
  private static readonly ISSUER = 'Ava'
  private static readonly BACKUP_CODES_COUNT = 8
  private static readonly BACKUP_CODE_LENGTH = 8

  /**
   * Generate a new 2FA secret and QR code for a user
   */
  static async generateSecret(userId: string, userEmail: string): Promise<TwoFASecret> {
    try {
      // Generate secret
      const secret = speakeasy.generateSecret({
        name: `${this.APP_NAME} : ${userEmail}`,
        issuer: this.ISSUER,
        length: 32
      })

      if (!secret.base32) {
        throw new Error('Failed to generate secret')
      }

      // Generate QR code
      const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url!)

      // Generate backup codes
      const backupCodes = this.generateBackupCodes()

      // Store in database (not enabled yet, just the secret)
      const { error } = await supabaseAdmin
        .from('user_2fa')
        .upsert({
          user_id: userId,
          secret: secret.base32,
          backup_codes: backupCodes,
          is_enabled: false,
          enabled_at: null
        }, {
          onConflict: 'user_id'
        })

      if (error) {
        throw new Error(`Failed to store 2FA secret: ${error.message}`)
      }

      return {
        secret: secret.base32,
        qrCodeUrl,
        backupCodes,
      }
    } catch (error) {
      console.error('Error generating 2FA secret:', error)
      throw new Error('Failed to generate 2FA secret')
    }
  }

  /**
   * Verify a TOTP token against the user's secret
   */
  static async verifyToken(userId: string, token: string, isBackupCode = false): Promise<boolean> {
    try {
      // Get user's 2FA configuration
      const { data: twoFAConfig, error } = await supabaseAdmin
        .from('user_2fa')
        .select('*')
        .eq('user_id', userId)
        .single()

      if (error || !twoFAConfig) {
        return false
      }

      // If it's a backup code, verify against stored backup codes
      if (isBackupCode) {
        return this.verifyBackupCode(userId, token, twoFAConfig.backup_codes || [])
      }

      // Verify TOTP token
      const verified = speakeasy.totp.verify({
        secret: twoFAConfig.secret,
        encoding: 'base32',
        token: token,
        window: 2 // Allow 2 time steps (60 seconds) tolerance
      })

      return verified
    } catch (error) {
      console.error('Error verifying 2FA token:', error)
      return false
    }
  }

  /**
   * Enable 2FA for a user after successful verification
   */
  static async enable2FA(userId: string, token: string): Promise<boolean> {
    try {
      // First verify the token
      const isValid = await this.verifyToken(userId, token)
      if (!isValid) {
        return false
      }

      // Enable 2FA
      const { error } = await supabaseAdmin
        .from('user_2fa')
        .update({
          is_enabled: true,
          enabled_at: new Date().toISOString()
        })
        .eq('user_id', userId)

      if (error) {
        throw new Error(`Failed to enable 2FA: ${error.message}`)
      }

      return true
    } catch (error) {
      console.error('Error enabling 2FA:', error)
      return false
    }
  }

  /**
   * Disable 2FA for a user after verification
   */
  static async disable2FA(userId: string, token: string): Promise<boolean> {
    try {
      // First verify the token
      const isValid = await this.verifyToken(userId, token)
      if (!isValid) {
        return false
      }

      // Disable 2FA
      const { error } = await supabaseAdmin
        .from('user_2fa')
        .update({
          is_enabled: false,
          enabled_at: null
        })
        .eq('user_id', userId)

      if (error) {
        throw new Error(`Failed to disable 2FA: ${error.message}`)
      }

      return true
    } catch (error) {
      console.error('Error disabling 2FA:', error)
      return false
    }
  }

  /**
   * Check if user has 2FA enabled
   */
  static async is2FAEnabled(userId: string): Promise<boolean> {
    try {
      const { data, error } = await supabaseAdmin
        .from('user_2fa')
        .select('is_enabled')
        .eq('user_id', userId)
        .eq('is_enabled', true)
        .single()

      return !error && !!data
    } catch (error) {
      return false
    }
  }

  /**
   * Get user's 2FA configuration
   */
  static async get2FAConfig(userId: string): Promise<TwoFAConfig | null> {
    try {
      const { data, error } = await supabaseAdmin
        .from('user_2fa')
        .select('*')
        .eq('user_id', userId)
        .single()

      if (error || !data) {
        return null
      }

      return {
        userId: data.user_id,
        secret: data.secret,
        isEnabled: data.is_enabled,
        enabledAt: data.enabled_at,
        backupCodes: data.backup_codes
      }
    } catch (error) {
      console.error('Error getting 2FA config:', error)
      return null
    }
  }

  /**
   * Generate backup codes for 2FA
   */
  private static generateBackupCodes(): string[] {
    const codes: string[] = []
    for (let i = 0; i < this.BACKUP_CODES_COUNT; i++) {
      const code = crypto.randomBytes(this.BACKUP_CODE_LENGTH / 2).toString('hex').toUpperCase()
      codes.push(code)
    }
    return codes
  }

  /**
   * Verify backup code and remove it from the list
   */
  private static async verifyBackupCode(userId: string, code: string, backupCodes: string[]): Promise<boolean> {
    try {
      const codeIndex = backupCodes.indexOf(code.toUpperCase())
      if (codeIndex === -1) {
        return false
      }

      // Remove the used backup code
      const updatedCodes = backupCodes.filter((_, index) => index !== codeIndex)

      // Update the database
      const { error } = await supabaseAdmin
        .from('user_2fa')
        .update({
          backup_codes: updatedCodes
        })
        .eq('user_id', userId)

      if (error) {
        console.error('Error updating backup codes:', error)
        return false
      }

      return true
    } catch (error) {
      console.error('Error verifying backup code:', error)
      return false
    }
  }

  /**
   * Regenerate backup codes for a user
   */
  static async regenerateBackupCodes(userId: string, token: string): Promise<string[] | null> {
    try {
      // First verify the token
      const isValid = await this.verifyToken(userId, token)
      if (!isValid) {
        return null
      }

      // Generate new backup codes
      const newBackupCodes = this.generateBackupCodes()

      // Update in database
      const { error } = await supabaseAdmin
        .from('user_2fa')
        .update({
          backup_codes: newBackupCodes
        })
        .eq('user_id', userId)

      if (error) {
        throw new Error(`Failed to regenerate backup codes: ${error.message}`)
      }

      return newBackupCodes
    } catch (error) {
      console.error('Error regenerating backup codes:', error)
      return null
    }
  }
}

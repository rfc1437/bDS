/**
 * SecureKeyStore - Encrypts API keys using Electron's safeStorage (OS keychain)
 *
 * Uses safeStorage to encrypt strings via the OS-native credential store:
 * - macOS: Keychain
 * - Windows: DPAPI
 * - Linux: libsecret
 *
 * Encrypted values are stored as base64 strings in the SQLite settings table
 * under a `__encrypted_` prefixed key. No plain-text fallback.
 */

import { safeStorage } from 'electron';
import type { ChatEngine } from './ChatEngine';

const ENCRYPTED_PREFIX = '__encrypted_';

export class SecureKeyStore {
  private engine: ChatEngine;

  constructor(engine: ChatEngine) {
    this.engine = engine;
  }

  /**
   * Check if safeStorage encryption is available on this platform.
   */
  isAvailable(): boolean {
    return safeStorage.isEncryptionAvailable();
  }

  /**
   * Encrypt and store a value in the settings table.
   * @throws if safeStorage is not available
   */
  async store(key: string, value: string): Promise<void> {
    if (!this.isAvailable()) {
      throw new Error('Secure storage is not available on this platform');
    }

    const encrypted = safeStorage.encryptString(value);
    const base64 = encrypted.toString('base64');
    await this.engine.setSetting(`${ENCRYPTED_PREFIX}${key}`, base64);
  }

  /**
   * Retrieve and decrypt a value from the settings table.
   * @returns the decrypted value, or null if the key does not exist
   * @throws if safeStorage is not available
   */
  async retrieve(key: string): Promise<string | null> {
    if (!this.isAvailable()) {
      throw new Error('Secure storage is not available on this platform');
    }

    const base64 = await this.engine.getSetting(`${ENCRYPTED_PREFIX}${key}`);
    if (base64 === null) {
      return null;
    }

    const encrypted = Buffer.from(base64, 'base64');
    return safeStorage.decryptString(encrypted);
  }

  /**
   * Remove an encrypted key from the settings table.
   */
  async remove(key: string): Promise<void> {
    await this.engine.deleteSetting(`${ENCRYPTED_PREFIX}${key}`);
  }

  /**
   * Delete a plain-text key from the settings table.
   * Used during upgrade to clean up old unencrypted API keys.
   */
  async cleanupPlainTextKey(key: string): Promise<void> {
    await this.engine.deleteSetting(key);
  }
}

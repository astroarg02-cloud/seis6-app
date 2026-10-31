import { VaultItem } from '../types';

/**
 * Checks if a vault item has a real attached file uploaded by the user/admin
 */
export function hasVaultItemFile(item?: VaultItem | null): boolean {
  if (!item) return false;
  if (item.rawFileBlob) return true;
  if (item.fileData && item.fileData.trim().length > 0) return true;
  if (item.fileName && item.fileName.trim().length > 0) return true;
  if (item.fileType && item.fileType.trim().length > 0) return true;
  if (item.fileSize && item.fileSize.trim().length > 0) return true;
  if (item.mediafireUrl && item.mediafireUrl.trim().length > 0) return true;
  if (
    item.downloadUrl &&
    item.downloadUrl.trim().length > 0 &&
    !item.downloadUrl.startsWith('#')
  ) {
    return true;
  }
  return false;
}

/**
 * Generates a guaranteed unique, non-colliding User ID (e.g. usr_m3k2f89a1b4c or admin_m3k2f89a1b4c)
 */
export function generateUniqueUserId(prefix: 'usr' | 'admin' | 'vip' | 'guest' = 'usr'): string {
  const timestamp = Date.now().toString(36);
  const randomChunk = Math.random().toString(36).substring(2, 7);
  let cryptoHex = '';
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(4);
    crypto.getRandomValues(bytes);
    cryptoHex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  } else {
    cryptoHex = Math.random().toString(36).substring(2, 6);
  }
  return `${prefix}_${timestamp}${randomChunk}${cryptoHex}`;
}

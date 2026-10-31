import { createClient, SupabaseClient, User as SupabaseAuthUser } from '@supabase/supabase-js';
import { VaultItem, UserProfile } from '../types';
import { INITIAL_VAULT_ITEMS, isAuthorizedAdminEmail, isAuthorizedAdminKey, ADMIN_AUTHORIZED_EMAIL, ADMIN_SECURITY_KEY } from '../data/initialVaultData';
import { generateUniqueUserId } from '../utils/vaultHelpers';
import { resolveApiUrl, safeFetchApi, safeFetchJson, isStandaloneApp, getRemoteServerBaseUrl } from './firebaseService';

// Vite environment accessor safe for TypeScript
const env = (import.meta as any).env || {};
const supabaseUrl = env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = env.VITE_SUPABASE_ANON_KEY || '';

export const isSupabaseConfigured = Boolean(
  supabaseUrl && 
  supabaseAnonKey && 
  !supabaseUrl.includes('placeholder') &&
  supabaseUrl.startsWith('http')
);

// Initialize client only if variables are properly provided
export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

const STORAGE_SESSION_KEY = 'app66_active_session_v1';
const STORAGE_VAULT_ITEMS_KEY = 'app66_vault_items_v1';

// Database & Authentication helper functions with automatic fallback and persistent sessions
export const supabaseService = {
  // --- LOCAL PERSISTENCE HELPERS ---
  saveSession(user: UserProfile | null): void {
    try {
      if (user) {
        localStorage.setItem(STORAGE_SESSION_KEY, JSON.stringify(user));
      } else {
        localStorage.removeItem(STORAGE_SESSION_KEY);
      }
    } catch (e) {
      console.warn('Could not write session to localStorage:', e);
    }
  },

  getLocalSession(): UserProfile | null {
    try {
      const stored = localStorage.getItem(STORAGE_SESSION_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed && parsed.uid && parsed.role) {
          return parsed as UserProfile;
        }
      }
    } catch (e) {
      console.warn('Could not read session from localStorage:', e);
    }
    return null;
  },

  saveLocalVaultItems(items: VaultItem[]): void {
    try {
      localStorage.setItem(STORAGE_VAULT_ITEMS_KEY, JSON.stringify(items));
      // Purge legacy keys so old deleted items never resurrect
      const legacyKeys = [
        'vip_vault_items_local_v3',
        'vip_vault_items_v2',
        'vip_vault_items',
        'vault_items',
        'app_vault_items',
      ];
      for (const k of legacyKeys) {
        localStorage.removeItem(k);
      }
    } catch (e) {
      console.warn('Could not save vault items to localStorage:', e);
    }
  },

  getLocalVaultItems(): VaultItem[] | null {
    try {
      let deletedSet = new Set<string>();
      try {
        const rawDel = localStorage.getItem('vault_deleted_item_ids');
        if (rawDel) {
          const parsed = JSON.parse(rawDel);
          if (Array.isArray(parsed)) deletedSet = new Set(parsed.map(String));
        }
      } catch {}

      const keysToScan = [
        STORAGE_VAULT_ITEMS_KEY,
        'vip_vault_items_local_v3',
        'vip_vault_items_v2',
        'vip_vault_items',
        'vault_items',
        'app_vault_items',
      ];

      const itemMap = new Map<string, VaultItem>();

      for (const k of keysToScan) {
        const stored = localStorage.getItem(k);
        if (stored) {
          try {
            const parsed = JSON.parse(stored);
            if (Array.isArray(parsed)) {
              parsed.forEach((it) => {
                if (
                  it &&
                  it.id &&
                  it.title &&
                  !deletedSet.has(it.id) &&
                  !it.id.startsWith('res_00') &&
                  !it.id.startsWith('test-')
                ) {
                  if (!itemMap.has(it.id)) {
                    itemMap.set(it.id, it as VaultItem);
                  }
                }
              });
            }
          } catch (pe) {}
        }
      }

      if (itemMap.size > 0) {
        return Array.from(itemMap.values());
      }
    } catch (e) {
      console.warn('Could not load vault items from localStorage:', e);
    }
    return null;
  },

  async getCurrentUser(): Promise<UserProfile | null> {
    // 1. If Supabase is configured, check live session
    if (supabase) {
      try {
        const { data: { session }, error } = await supabase.auth.getSession();
        if (!error && session && session.user) {
          const profile = this.mapSupabaseUserToProfile(session.user);
          this.saveSession(profile);
          return profile;
        }
      } catch (err) {
        console.warn('Error fetching current Supabase session:', err);
      }
    }

    // 2. Persistent fallback from local storage (keeps users logged in across page reloads/browser sessions)
    return this.getLocalSession();
  },

  async signUp(
    email: string, 
    password: string, 
    displayName?: string, 
    adminKey?: string
  ): Promise<{ user: UserProfile | null; error: string | null }> {
    const wantsAdmin = Boolean(adminKey && adminKey.trim().length > 0);
    if (wantsAdmin && !isAuthorizedAdminKey(adminKey)) {
      return { user: null, error: 'Clave de Administrador incorrecta. Se requiere la Key correcta.' };
    }

    const isAdmin = wantsAdmin && isAuthorizedAdminKey(adminKey);

    if (!supabase) {
      const user: UserProfile = {
        uid: isAdmin ? 'admin_master_astro' : generateUniqueUserId('usr'),
        email,
        displayName: displayName || (isAdmin ? 'Administrador Root' : 'Miembro VIP'),
        role: isAdmin ? 'admin' : 'vip_member',
        tier: isAdmin ? 'Bóveda Diamante' : 'Acceso VIP',
        joinedAt: new Date().toISOString().split('T')[0],
      };
      this.saveSession(user);
      return { user, error: null };
    }

    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            display_name: displayName || (isAdmin ? 'Administrador' : 'Miembro VIP'),
            is_admin: isAdmin,
          },
        },
      });

      if (error) {
        return { user: null, error: error.message };
      }

      if (data.user) {
        const profile = this.mapSupabaseUserToProfile(data.user, displayName, isAdmin);
        this.saveSession(profile);
        return { user: profile, error: null };
      }

      return { user: null, error: 'No se pudo crear la cuenta' };
    } catch (err: any) {
      return { user: null, error: err.message || 'Error al registrarse con Supabase' };
    }
  },

  async signIn(
    email: string, 
    password: string, 
    adminKey?: string
  ): Promise<{ user: UserProfile | null; error: string | null }> {
    const wantsAdmin = Boolean(adminKey && adminKey.trim().length > 0);
    if (wantsAdmin && !isAuthorizedAdminKey(adminKey)) {
      return { user: null, error: 'Clave de Administrador incorrecta. Se requiere la Key correcta.' };
    }

    const isAdmin = wantsAdmin && isAuthorizedAdminKey(adminKey);

    if (!supabase) {
      const fallbackName = email ? email.split('@')[0] : 'Usuario';
      const user: UserProfile = {
        uid: isAdmin ? 'admin_master_astro' : generateUniqueUserId('usr'),
        email,
        displayName: isAdmin ? 'Administrador Root' : `${fallbackName} (VIP)`,
        role: isAdmin ? 'admin' : 'vip_member',
        tier: isAdmin ? 'Bóveda Diamante' : 'Acceso VIP',
        joinedAt: new Date().toISOString().split('T')[0],
      };
      this.saveSession(user);
      return { user, error: null };
    }

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        return { user: null, error: error.message };
      }

      if (data.user) {
        const profile = this.mapSupabaseUserToProfile(data.user, undefined, isAdmin);
        this.saveSession(profile);
        return { user: profile, error: null };
      }

      return { user: null, error: 'Error al verificar credenciales' };
    } catch (err: any) {
      return { user: null, error: err.message || 'Error en autenticación' };
    }
  },

  async signInWithGoogle(customEmail?: string, customName?: string, customAvatar?: string): Promise<{ user: UserProfile | null; error: string | null }> {
    const email = (customEmail || 'miembro.vip@gmail.com').trim().toLowerCase();
    
    const fallbackName = customName || (email.split('@')[0] ? email.split('@')[0].replace(/[._]/g, ' ') : 'Miembro VIP');
    const formattedName = fallbackName.charAt(0).toUpperCase() + fallbackName.slice(1);
    const avatar = customAvatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(email)}&backgroundColor=0066fe,0052ff`;

    const user: UserProfile = {
      uid: generateUniqueUserId('usr'),
      email,
      displayName: `${formattedName} (Google VIP)`,
      role: 'vip_member',
      tier: 'Acceso VIP',
      avatarUrl: avatar,
      joinedAt: new Date().toISOString().split('T')[0],
    };

    this.saveSession(user);

    if (supabase) {
      try {
        supabase.auth.signInWithOAuth({
          provider: 'google',
          options: {
            redirectTo: typeof window !== 'undefined' ? window.location.origin : undefined,
          },
        }).catch(() => {});
      } catch (err) {
        console.warn('Supabase OAuth notice:', err);
      }
    }

    return { user, error: null };
  },

  async signOut(): Promise<void> {
    this.saveSession(null);
    if (!supabase) return;
    try {
      await supabase.auth.signOut();
    } catch (err) {
      console.warn('Error signing out of Supabase:', err);
    }
  },

  mapSupabaseUserToProfile(sbUser: SupabaseAuthUser, overrideName?: string, forceAdmin?: boolean): UserProfile {
    const email = sbUser.email || '';
    const meta = sbUser.user_metadata || {};
    const isAdmin = forceAdmin !== undefined ? forceAdmin : Boolean(meta.is_admin);
    const name = overrideName || meta.display_name || meta.name || (isAdmin ? 'Administrador' : email.split('@')[0] || 'Miembro VIP');

    return {
      uid: sbUser.id,
      email,
      displayName: name,
      role: isAdmin ? 'admin' : 'vip_member',
      tier: isAdmin ? 'Bóveda Diamante' : 'Acceso VIP',
      joinedAt: sbUser.created_at ? new Date(sbUser.created_at).toISOString().split('T')[0] : '2026-08-22',
    };
  },

  // --- DATABASE METHODS ---
  async fetchVaultItems(): Promise<VaultItem[]> {
    let serverItems: VaultItem[] = [];

    // 1. Fetch from Central Express Server (/api/vault/items) if server is available
    if (!isStandaloneApp() || getRemoteServerBaseUrl()) {
      try {
        const json = await safeFetchJson<{ items?: VaultItem[] }>('/api/vault/items', {}, 2000);
        if (json && Array.isArray(json.items) && json.items.length > 0) {
          serverItems = json.items;
        }
      } catch (e) {
        console.warn('Backend server items fetch notice:', e);
      }
    }

    // 2. Try fetching from Supabase if configured
    if (supabase) {
      try {
        const { data, error } = await supabase
          .from('vault_items')
          .select('*')
          .order('created_at', { ascending: false });

        if (!error && data && data.length > 0) {
          const mappedItems: VaultItem[] = data.map((row: any) => ({
            id: row.id,
            title: row.title,
            description: row.description || '',
            category: row.category || 'code',
            fileType: row.file_type || row.fileType || '',
            downloadUrl: row.download_url || row.downloadUrl || '',
            fileSize: row.file_size || row.fileSize || '',
            coverImage: row.cover_image || row.coverImage || '',
            fileName: row.file_name || row.fileName || undefined,
            fileMimeType: row.file_mime_type || row.fileMimeType || undefined,
            fileData: row.file_data || row.fileData || undefined,
            likesCount: Number(row.likes_count ?? row.likesCount ?? 0),
            likedBy: Array.isArray(row.liked_by) ? row.liked_by : (row.likedBy || []),
            createdAt: row.created_at ? new Date(row.created_at).toISOString().split('T')[0] : '2026-08-22',
            comments: Array.isArray(row.comments) ? row.comments : [],
            isLockedForTier: Boolean(row.is_locked_for_tier ?? row.isLockedForTier),
            version: row.version || 'v1.0.0',
            author: row.author || {
              name: 'Bóveda Central',
              badge: 'ADMIN'
            }
          }));

          // Merge server and supabase
          const map = new Map<string, VaultItem>();
          serverItems.forEach(i => map.set(i.id, i));
          mappedItems.forEach(i => {
            if (!map.has(i.id)) map.set(i.id, i);
          });
          serverItems = Array.from(map.values());
        }
      } catch (err) {
        console.warn('Error connecting to Supabase:', err);
      }
    }

    let deletedSet = new Set<string>();
    try {
      const rawDel = localStorage.getItem('vault_deleted_item_ids');
      if (rawDel) {
        const parsed = JSON.parse(rawDel);
        if (Array.isArray(parsed)) deletedSet = new Set(parsed.map(String));
      }
    } catch {}

    // 3. If server items found, persist locally (strict non-deleted filtering)
    const localItems = (this.getLocalVaultItems() || []).filter(i => i && i.id && !deletedSet.has(i.id));
    if (serverItems.length > 0) {
      serverItems = serverItems.filter(i => i && i.id && !deletedSet.has(i.id));
      this.saveLocalVaultItems(serverItems);
      return serverItems;
    }

    // 4. If server was empty but local has items
    if (localItems && localItems.length > 0) {
      return localItems.filter(i => !deletedSet.has(i.id));
    }

    // 5. Initial seed only if first run and never initialized
    const hasInit = typeof window !== 'undefined' && localStorage.getItem('vault_initialized');
    if (!hasInit) {
      if (typeof window !== 'undefined') localStorage.setItem('vault_initialized', 'true');
      const seedItems = INITIAL_VAULT_ITEMS.filter(i => !deletedSet.has(i.id));
      this.saveLocalVaultItems(seedItems);
      return seedItems;
    }
    return [];
  },

  async insertVaultItem(item: VaultItem): Promise<boolean> {
    // 1. Immediately persist to localStorage
    try {
      const currentItems = this.getLocalVaultItems() || INITIAL_VAULT_ITEMS;
      const updated = [item, ...currentItems.filter(i => i.id !== item.id)];
      this.saveLocalVaultItems(updated);
    } catch (e) {
      console.warn('Error persisting item locally:', e);
    }

    // 2. Persist to Central Express Server API if available
    if (!isStandaloneApp() || getRemoteServerBaseUrl()) {
      try {
        await safeFetchApi('/api/vault/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(item),
        }, 2000);
      } catch (e) {
        console.warn('Could not post to server API:', e);
      }
    }

    // 3. Sync to Supabase if configured
    if (supabase) {
      try {
        await supabase.from('vault_items').insert([
          {
            id: item.id,
            title: item.title,
            description: item.description,
            category: item.category || 'code',
            file_type: item.fileType || '',
            download_url: item.downloadUrl || '',
            file_size: item.fileSize || '',
            cover_image: item.coverImage || '',
            likes_count: item.likesCount || 0,
            liked_by: item.likedBy || [],
            comments: item.comments || [],
            is_locked_for_tier: item.isLockedForTier || false,
            version: item.version || 'v1.0',
            author: item.author || { name: 'Admin', badge: 'ADMIN' },
          },
        ]);
      } catch (err) {
        console.error('Failed to insert item to Supabase:', err);
      }
    }

    return true;
  },

  async updateItemLikes(itemId: string, likesCount: number, likedBy: string[]): Promise<boolean> {
    // 1. Update in local storage
    try {
      const currentItems = this.getLocalVaultItems();
      if (currentItems) {
        const updated = currentItems.map(item => 
          item.id === itemId ? { ...item, likesCount, likedBy } : item
        );
        this.saveLocalVaultItems(updated);
      }
    } catch (e) {
      console.warn('Error updating likes locally:', e);
    }

    // 2. Update on central server if available
    if (!isStandaloneApp() || getRemoteServerBaseUrl()) {
      safeFetchApi(`/api/vault/items/${itemId}/like`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ likesCount, likedBy }),
      }, 2000).catch(() => {});
    }

    // 3. Update in Supabase
    if (supabase) {
      try {
        await supabase
          .from('vault_items')
          .update({
            likes_count: likesCount,
            liked_by: likedBy,
          })
          .eq('id', itemId);
      } catch (err) {
        console.error('Failed to update likes in Supabase:', err);
      }
    }

    return true;
  },

  async updateItemComments(itemId: string, comments: any[]): Promise<boolean> {
    // 1. Update in local storage
    try {
      const currentItems = this.getLocalVaultItems();
      if (currentItems) {
        const updated = currentItems.map(item => 
          item.id === itemId ? { ...item, comments } : item
        );
        this.saveLocalVaultItems(updated);
      }
    } catch (e) {
      console.warn('Error updating comments locally:', e);
    }

    // 2. Update on central server if available
    if (!isStandaloneApp() || getRemoteServerBaseUrl()) {
      safeFetchApi(`/api/vault/items/${itemId}/comment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comments }),
      }, 2000).catch(() => {});
    }

    // 3. Update in Supabase
    if (supabase) {
      try {
        await supabase
          .from('vault_items')
          .update({ comments })
          .eq('id', itemId);
      } catch (err) {
        console.error('Failed to update comments in Supabase:', err);
      }
    }

    return true;
  },

  async deleteVaultItem(itemId: string): Promise<boolean> {
    try {
      const raw = localStorage.getItem('vault_deleted_item_ids');
      const set = new Set<string>(raw ? JSON.parse(raw) : []);
      set.add(itemId);
      localStorage.setItem('vault_deleted_item_ids', JSON.stringify(Array.from(set)));
    } catch {}

    try {
      const currentItems = this.getLocalVaultItems();
      if (currentItems) {
        this.saveLocalVaultItems(currentItems.filter((i) => i.id !== itemId));
      }
      // Clean legacy keys
      const legacyKeys = [
        STORAGE_VAULT_ITEMS_KEY,
        'vip_vault_items_local_v3',
        'vip_vault_items_v2',
        'vip_vault_items',
        'vault_items',
        'app_vault_items',
      ];
      for (const k of legacyKeys) {
        const stored = localStorage.getItem(k);
        if (stored) {
          try {
            const parsed = JSON.parse(stored);
            if (Array.isArray(parsed)) {
              localStorage.setItem(k, JSON.stringify(parsed.filter((it: any) => it && it.id !== itemId)));
            }
          } catch {}
        }
      }
    } catch {}

    if (!isStandaloneApp() || getRemoteServerBaseUrl()) {
      safeFetchApi(`/api/vault/items/${itemId}`, { method: 'DELETE' }, 2000).catch(() => {});
    }

    if (supabase) {
      try {
        await supabase.from('vault_items').delete().eq('id', itemId);
      } catch {}
    }

    return true;
  }
};

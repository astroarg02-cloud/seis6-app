import { UserProfile } from '../types';
import { firebaseService, firestoreRestFetch, isStandaloneApp } from './firebaseService';

export interface LiveSyncConfig {
  enabled: boolean;
  liveServerUrl: string;
  version: string;
  buildTimestamp: string;
  forceRefreshId: string;
  lastPingMs?: number;
  notes?: string;
  updatedAt?: string;
  updatedBy?: string;
}

const STORAGE_KEY_LIVE_URL = 'vault_live_server_url';
const STORAGE_KEY_LIVE_ENABLED = 'vault_live_sync_enabled';
const STORAGE_KEY_LAST_REFRESH_ID = 'vault_last_force_refresh_id';
const STORAGE_KEY_APP_BOOT_ORIGIN = 'vault_app_boot_origin';

// Official GitHub Pages deployment URL for this repository
export const DEFAULT_OFFICIAL_LIVE_URL = 'https://astroarg02-cloud.github.io/seis6-app/';

export const liveSyncService = {
  /**
   * Returns the current live server URL (from localStorage, env, or default GitHub Pages).
   */
  getLiveServerUrl(): string {
    if (typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem(STORAGE_KEY_LIVE_URL);
        if (stored && stored.startsWith('http')) {
          return stored.endsWith('/') ? stored : `${stored}/`;
        }
      } catch {}
    }
    const envUrl = (
      (import.meta as any).env?.VITE_LIVE_SERVER_URL ||
      (import.meta as any).env?.VITE_SERVER_URL ||
      ''
    ).trim();
    if (envUrl && envUrl.startsWith('http')) {
      return envUrl.endsWith('/') ? envUrl : `${envUrl}/`;
    }
    return DEFAULT_OFFICIAL_LIVE_URL;
  },

  /**
   * Sets the live server URL and updates localStorage.
   */
  setLiveServerUrl(url: string): void {
    if (typeof window === 'undefined') return;
    try {
      const cleanUrl = url.trim();
      if (cleanUrl) {
        const finalUrl = cleanUrl.endsWith('/') ? cleanUrl : `${cleanUrl}/`;
        localStorage.setItem(STORAGE_KEY_LIVE_URL, finalUrl);
      } else {
        localStorage.removeItem(STORAGE_KEY_LIVE_URL);
      }
    } catch {}
  },

  /**
   * Checks if Live OTA synchronization is enabled.
   */
  isLiveSyncEnabled(): boolean {
    if (typeof window === 'undefined') return false;
    try {
      const val = localStorage.getItem(STORAGE_KEY_LIVE_ENABLED);
      return val !== 'false';
    } catch {
      return true;
    }
  },

  /**
   * Enables or disables Live OTA synchronization.
   */
  setLiveSyncEnabled(enabled: boolean): void {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(STORAGE_KEY_LIVE_ENABLED, String(enabled));
    } catch {}
  },

  /**
   * Checks if the app is currently running from a local standalone scheme (Capacitor/file/localhost).
   */
  isLocalStandalone(): boolean {
    if (typeof window === 'undefined') return false;
    try {
      const { protocol, hostname } = window.location;
      const isCapNative = (window as any).Capacitor?.isNativePlatform
        ? (window as any).Capacitor.isNativePlatform()
        : false;
      const isLocalProtocol =
        protocol === 'capacitor:' ||
        protocol === 'file:' ||
        protocol === 'ionic:' ||
        protocol === 'content:';
      const isLocalHost = hostname === 'localhost' || hostname === '127.0.0.1';

      return Boolean(isCapNative || isLocalProtocol || isLocalHost);
    } catch {
      return false;
    }
  },

  /**
   * Checks if the app is currently running on the live server.
   */
  isCurrentlyOnLiveServer(): boolean {
    if (typeof window === 'undefined') return false;
    try {
      const target = this.getLiveServerUrl();
      const current = window.location.href;
      const targetHost = new URL(target).hostname;
      const currentHost = window.location.hostname;

      return currentHost === targetHost || current.startsWith(target);
    } catch {
      return false;
    }
  },

  /**
   * Probes the live server URL with a fast non-blocking request to check connectivity and latency.
   */
  async probeLiveServer(url?: string, timeoutMs = 2500): Promise<{ reachable: boolean; latencyMs: number; status?: number; error?: string }> {
    const target = url || this.getLiveServerUrl();
    const start = performance.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      // Append cache buster to prevent stale browser cache
      const sep = target.includes('?') ? '&' : '?';
      const pingUrl = `${target}${sep}__probe=${Date.now()}`;

      const res = await fetch(pingUrl, {
        method: 'HEAD',
        cache: 'no-store',
        mode: 'no-cors', // ensures network reachability check succeeds even with strict CORS on static hosts
        signal: controller.signal,
      });

      clearTimeout(timer);
      const latencyMs = Math.round(performance.now() - start);
      return {
        reachable: true,
        latencyMs,
        status: res.status,
      };
    } catch (err: any) {
      clearTimeout(timer);
      // Even if mode: 'no-cors' returns opaque, or network timed out
      const latencyMs = Math.round(performance.now() - start);
      const isAbort = err?.name === 'AbortError';
      return {
        reachable: false,
        latencyMs,
        error: isAbort ? 'Tiempo de espera agotado' : (err?.message || 'Error de conexión'),
      };
    }
  },

  /**
   * Attempts to seamlessly transfer the local standalone app to the remote live URL if available.
   * Preserves current user session across the domain jump via secure URL fragment.
   */
  async syncToLiveServerIfAvailable(currentUser?: UserProfile | null): Promise<boolean> {
    if (typeof window === 'undefined') return false;
    if (!this.isLocalStandalone()) return false;
    if (!this.isLiveSyncEnabled()) return false;

    // Check if user manually opted out of live redirect in this session
    try {
      if (sessionStorage.getItem('vault_skip_live_sync_session') === 'true') {
        return false;
      }
    } catch {}

    const liveUrl = this.getLiveServerUrl();
    if (!liveUrl || !liveUrl.startsWith('http')) return false;

    // Avoid self-redirect loops
    if (this.isCurrentlyOnLiveServer()) return false;

    const probe = await this.probeLiveServer(liveUrl, 2000);
    if (!probe.reachable) {
      console.log('[LiveSync] Remote server unreachable or offline. Remaining in local standalone mode.');
      return false;
    }

    console.log('[LiveSync] Remote server reachable (' + probe.latencyMs + 'ms). Transitioning to live app...');

    try {
      // Record boot origin for optional return to local mode
      localStorage.setItem(STORAGE_KEY_APP_BOOT_ORIGIN, window.location.origin);
    } catch {}

    let redirectUrl = liveUrl;

    // Preserve active session across origins if logged in
    if (currentUser && currentUser.uid && currentUser.email) {
      try {
        const payload = JSON.stringify({
          uid: currentUser.uid,
          email: currentUser.email,
          role: currentUser.role,
          displayName: currentUser.displayName,
          avatarUrl: currentUser.avatarUrl,
          tier: currentUser.tier,
          membershipPlan: currentUser.membershipPlan,
          membershipStatus: currentUser.membershipStatus,
          ts: Date.now(),
        });
        const encoded = encodeURIComponent(payload);
        redirectUrl = `${liveUrl}#vault_sync_session=${encoded}`;
      } catch {}
    }

    try {
      window.location.replace(redirectUrl);
      return true;
    } catch (e) {
      console.warn('[LiveSync] Redirect failed:', e);
      return false;
    }
  },

  /**
   * Checks if incoming URL contains a transferred session, saves it, and wipes the fragment.
   */
  extractTransferredSession(): UserProfile | null {
    if (typeof window === 'undefined') return null;
    try {
      const hash = window.location.hash;
      if (!hash || !hash.includes('vault_sync_session=')) return null;

      const match = hash.match(/vault_sync_session=([^&]+)/);
      if (match && match[1]) {
        const decoded = decodeURIComponent(match[1]);
        const data = JSON.parse(decoded);
        if (data && data.uid && data.email) {
          const user: UserProfile = {
            uid: data.uid,
            email: data.email,
            role: data.role || 'member',
            displayName: data.displayName || data.email.split('@')[0],
            avatarUrl: data.avatarUrl || '',
            tier: data.tier || 'Estándar',
            membershipPlan: data.membershipPlan || 'free',
            membershipStatus: data.membershipStatus || 'active',
            joinedAt: new Date().toISOString(),
          };

          // Save to localStorage
          localStorage.setItem('app66_active_session_v1', JSON.stringify(user));

          // Clean hash from address bar immediately
          const cleanUrl = window.location.href.split('#')[0];
          window.history.replaceState(null, '', cleanUrl);

          return user;
        }
      }
    } catch (err) {
      console.warn('[LiveSync] Error extracting transferred session:', err);
    }
    return null;
  },

  /**
   * Forces a hot-reload of the app, invalidating any service worker or CacheStorage entries.
   */
  async forceAppHotReload(reason = 'Actualización en vivo solicitada'): Promise<void> {
    if (typeof window === 'undefined') return;
    try {
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
    } catch {}

    const sep = window.location.href.includes('?') ? '&' : '?';
    const cleanUrl = window.location.href.replace(/[?&]__t=\d+/, '');
    const reloadTarget = `${cleanUrl}${cleanUrl.includes('?') ? '&' : '?' }__t=${Date.now()}`;
    window.location.replace(reloadTarget);
  },

  /**
   * Fetches the global Live Sync configuration from Firebase Firestore REST.
   */
  async fetchLiveSyncCloudConfig(): Promise<LiveSyncConfig | null> {
    try {
      const res = await firestoreRestFetch('/system_config/live_sync', {}, 2500);
      if (res && res.ok) {
        const json = await res.json();
        const f = json.fields || {};
        const config: LiveSyncConfig = {
          enabled: f.enabled ? Boolean(f.enabled.booleanValue) : true,
          liveServerUrl: f.liveServerUrl ? String(f.liveServerUrl.stringValue) : DEFAULT_OFFICIAL_LIVE_URL,
          version: f.version ? String(f.version.stringValue) : '1.0.0',
          buildTimestamp: f.buildTimestamp ? String(f.buildTimestamp.stringValue) : '',
          forceRefreshId: f.forceRefreshId ? String(f.forceRefreshId.stringValue) : '',
          notes: f.notes ? String(f.notes.stringValue) : '',
          updatedAt: f.updatedAt ? String(f.updatedAt.stringValue) : '',
          updatedBy: f.updatedBy ? String(f.updatedBy.stringValue) : '',
        };
        return config;
      }
    } catch (err) {
      console.warn('[LiveSync] Cloud config fetch warning:', err);
    }
    return null;
  },

  /**
   * Publishes new Live Sync configuration to Firebase Firestore.
   */
  async publishLiveSyncCloudConfig(config: Partial<LiveSyncConfig>, adminEmail?: string): Promise<boolean> {
    const nowIso = new Date().toISOString();
    const liveServerUrl = (config.liveServerUrl || this.getLiveServerUrl()).trim();
    const enabled = config.enabled !== undefined ? config.enabled : this.isLiveSyncEnabled();
    const forceRefreshId = config.forceRefreshId || `ref-${Date.now()}`;
    const version = config.version || '1.0.1';
    const notes = config.notes || 'Actualización remota en vivo activada';

    // Update local cache
    this.setLiveServerUrl(liveServerUrl);
    this.setLiveSyncEnabled(enabled);

    try {
      const fields: Record<string, any> = {
        enabled: { booleanValue: enabled },
        liveServerUrl: { stringValue: liveServerUrl },
        version: { stringValue: version },
        buildTimestamp: { stringValue: nowIso },
        forceRefreshId: { stringValue: forceRefreshId },
        notes: { stringValue: notes },
        updatedAt: { stringValue: nowIso },
        updatedBy: { stringValue: adminEmail || 'admin' },
      };

      const res = await firestoreRestFetch('/system_config/live_sync', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields }),
      }, 3000);

      return Boolean(res && res.ok);
    } catch (err) {
      console.warn('[LiveSync] Cloud config publish error:', err);
      return false;
    }
  },

  /**
   * Listens for Cloud Live Sync updates in real-time or via interval, triggering hot-reload if forceRefreshId changes.
   */
  listenForCloudReloads(onReloadSignal?: (config: LiveSyncConfig) => void): () => void {
    if (typeof window === 'undefined') return () => {};

    let lastKnownRefreshId = '';
    try {
      lastKnownRefreshId = localStorage.getItem(STORAGE_KEY_LAST_REFRESH_ID) || '';
    } catch {}

    const checkConfig = async () => {
      const cloud = await this.fetchLiveSyncCloudConfig();
      if (!cloud) return;

      // Update local server URL if changed by admin
      if (cloud.liveServerUrl && cloud.liveServerUrl !== this.getLiveServerUrl()) {
        this.setLiveServerUrl(cloud.liveServerUrl);
      }

      // Check for force-refresh trigger
      if (cloud.forceRefreshId && cloud.forceRefreshId !== lastKnownRefreshId) {
        console.log('[LiveSync] New cloud force refresh detected:', cloud.forceRefreshId);
        lastKnownRefreshId = cloud.forceRefreshId;
        try {
          localStorage.setItem(STORAGE_KEY_LAST_REFRESH_ID, cloud.forceRefreshId);
        } catch {}

        if (onReloadSignal) {
          onReloadSignal(cloud);
        } else {
          this.forceAppHotReload('Nueva versión detectada en la nube');
        }
      }
    };

    // Initial check
    checkConfig().catch(() => {});

    // Periodic check every 25 seconds
    const interval = setInterval(() => {
      checkConfig().catch(() => {});
    }, 25000);

    return () => clearInterval(interval);
  },
};

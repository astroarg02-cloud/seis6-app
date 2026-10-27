import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  onAuthStateChanged,
  User as FirebaseUser,
  updateProfile,
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  collection,
  onSnapshot,
  getDocs,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  setLogLevel,
  enableNetwork,
} from 'firebase/firestore';
import rawFirebaseConfig from '../../firebase-applet-config.json';
import { UserProfile, VaultItem, VaultList, MembershipPlanType } from '../types';
import { isAuthorizedAdminEmail, isAuthorizedAdminKey, INITIAL_ADMIN_USER, INITIAL_MEMBER_USER, ADMIN_SECURITY_KEY, INITIAL_VAULT_LISTS } from '../data/initialVaultData';
import { generateUniqueUserId } from '../utils/vaultHelpers';

// Silence internal @firebase/firestore WebChannel backoff & quota console errors
try {
  setLogLevel('silent');
} catch {}

// Configuración de Firebase que prioriza las variables de entorno de Vite y usa el config local de respaldo
export const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || rawFirebaseConfig.apiKey,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || rawFirebaseConfig.authDomain,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || rawFirebaseConfig.projectId,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || rawFirebaseConfig.storageBucket,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || rawFirebaseConfig.messagingSenderId,
  appId: import.meta.env.VITE_FIREBASE_APP_ID || rawFirebaseConfig.appId,
};

export const firestoreDatabaseId: string =
  (import.meta.env as any).VITE_FIREBASE_DATABASE_ID ||
  (rawFirebaseConfig as any).firestoreDatabaseId ||
  '(default)';

export const FIRESTORE_REST_BASE = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/${encodeURIComponent(firestoreDatabaseId)}/documents`;

// Helper to detect if running inside Capacitor native container or file:// protocol without external HTTP server
export function isStandaloneApp(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const { protocol, hostname, port } = window.location;
    const isCapacitorNative = (window as any).Capacitor?.isNativePlatform ? (window as any).Capacitor.isNativePlatform() : false;
    const isLocalScheme = protocol === 'capacitor:' || protocol === 'file:' || protocol === 'ionic:' || protocol === 'content:';
    const isCapacitorLocalHost = (hostname === 'localhost' || hostname === '127.0.0.1') && (!port || port === '80' || port === '443');

    return Boolean(isCapacitorNative || isLocalScheme || isCapacitorLocalHost || (window as any).Capacitor);
  } catch {
    return false;
  }
}

// Configurable remote server URL (optional, if user runs a custom dedicated backend)
export function getRemoteServerBaseUrl(): string {
  if (typeof window !== 'undefined') {
    try {
      const saved = localStorage.getItem('vault_remote_server_url');
      if (saved && saved.startsWith('http')) return saved.replace(/\/+$/, '');
    } catch {}
  }
  const envUrl = (
    (import.meta.env as any).VITE_SERVER_URL ||
    (import.meta.env as any).VITE_API_URL ||
    ''
  ).trim();
  if (envUrl && envUrl.startsWith('http')) {
    return envUrl.replace(/\/+$/, '');
  }
  return '';
}

// Resolves API URLs cleanly without hardcoded domains
export function resolveApiUrl(path: string): string {
  if (!path.startsWith('/')) return path;
  try {
    if (typeof window !== 'undefined') {
      const remoteBase = getRemoteServerBaseUrl();
      if (remoteBase) {
        return `${remoteBase}${path}`;
      }
      // In standalone APK mode without a custom remote backend server, return path directly
      return path;
    }
  } catch {}
  return path;
}

// Safe API fetch with timeout that skips local Express calls when running as a standalone mobile APK
export async function safeFetchApi(
  path: string,
  options: RequestInit = {},
  timeoutMs = 2500
): Promise<Response | null> {
  // When running inside an APK with no remote server URL configured, skip trying to hit missing local endpoint
  if (isStandaloneApp() && !getRemoteServerBaseUrl()) {
    return null;
  }
  const fullUrl = resolveApiUrl(path);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(fullUrl, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timer);
    return res;
  } catch {
    clearTimeout(timer);
    return null;
  }
}

// Safe JSON fetch that ensures response is actually JSON and not HTML (e.g. index.html SPA fallback)
export async function safeFetchJson<T = any>(
  path: string,
  options: RequestInit = {},
  timeoutMs = 2500
): Promise<T | null> {
  const res = await safeFetchApi(path, options, timeoutMs);
  if (!res || !res.ok) return null;
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    return null;
  }
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

// Initialize Firebase SDK connected to the provisioned named Firestore database
export const firebaseApp = !getApps().length ? initializeApp(firebaseConfig) : getApp();
export const auth = getAuth(firebaseApp);
export const db =
  firestoreDatabaseId && firestoreDatabaseId !== '(default)'
    ? getFirestore(firebaseApp, firestoreDatabaseId)
    : getFirestore(firebaseApp);
export const googleAuthProvider = new GoogleAuthProvider();

const LEGACY_QUOTA_KEY = `vault_firestore_quota_${firebaseConfig.projectId}`;
const FIRESTORE_WRITE_QUOTA_KEY = `vault_firestore_write_quota_${firebaseConfig.projectId}`;
const FIRESTORE_READ_QUOTA_KEY = `vault_firestore_read_quota_${firebaseConfig.projectId}`;
let memoryWriteQuotaCooldownUntil = 0;
let memoryReadQuotaCooldownUntil = 0;

// Clean up legacy quota key that previously blocked reads when write quota was reached, and ensure SDK network is enabled
try {
  if (typeof window !== 'undefined') {
    sessionStorage.removeItem(LEGACY_QUOTA_KEY);
    localStorage.removeItem(LEGACY_QUOTA_KEY);
  }
  enableNetwork(db).catch(() => {});
} catch {}

export function isFirestoreWriteQuotaExhausted(): boolean {
  if (Date.now() < memoryWriteQuotaCooldownUntil) return true;
  try {
    const raw =
      sessionStorage.getItem(FIRESTORE_WRITE_QUOTA_KEY) ||
      localStorage.getItem(FIRESTORE_WRITE_QUOTA_KEY);
    if (raw) {
      const until = Number(raw);
      if (until > Date.now()) {
        memoryWriteQuotaCooldownUntil = until;
        return true;
      }
    }
  } catch {}
  return false;
}

export function isFirestoreReadQuotaExhausted(): boolean {
  if (Date.now() < memoryReadQuotaCooldownUntil) return true;
  try {
    const raw =
      sessionStorage.getItem(FIRESTORE_READ_QUOTA_KEY) ||
      localStorage.getItem(FIRESTORE_READ_QUOTA_KEY);
    if (raw) {
      const until = Number(raw);
      if (until > Date.now()) {
        memoryReadQuotaCooldownUntil = until;
        return true;
      }
    }
  } catch {}
  return false;
}

// Backwards-compatible alias for write quota check
export function isFirestoreQuotaExhausted(): boolean {
  return isFirestoreWriteQuotaExhausted();
}

export function handleFirestoreError(err: any, isReadOperation = false): void {
  const code = String(err?.code || err?.status || '');
  const msg = String(err?.message || err || '');
  if (
    code.includes('resource-exhausted') ||
    code === '429' ||
    msg.includes('resource-exhausted') ||
    msg.includes('RESOURCE_EXHAUSTED') ||
    msg.includes('Quota exceeded') ||
    msg.includes('Quota limit exceeded') ||
    msg.includes('429')
  ) {
    const isExplicitWriteQuota =
      msg.toLowerCase().includes('write') || !isReadOperation;

    const until = Date.now() + 15 * 60 * 1000;
    if (isExplicitWriteQuota) {
      memoryWriteQuotaCooldownUntil = until;
      try {
        sessionStorage.setItem(FIRESTORE_WRITE_QUOTA_KEY, String(until));
        localStorage.setItem(FIRESTORE_WRITE_QUOTA_KEY, String(until));
      } catch {}
    } else {
      memoryReadQuotaCooldownUntil = until;
      try {
        sessionStorage.setItem(FIRESTORE_READ_QUOTA_KEY, String(until));
        localStorage.setItem(FIRESTORE_READ_QUOTA_KEY, String(until));
      } catch {}
    }
  }
}

export async function firestoreRestFetch(
  docPath: string,
  options: RequestInit = {},
  timeoutMs = 2500
): Promise<Response | null> {
  const method = String(options.method || 'GET').toUpperCase();
  const isRead = method === 'GET' || method === 'HEAD';
  if (isRead ? isFirestoreReadQuotaExhausted() : isFirestoreWriteQuotaExhausted()) {
    return null;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const sep = docPath.includes('?') ? '&' : '?';
    const url = `${FIRESTORE_REST_BASE}${docPath}${firebaseConfig.apiKey ? `${sep}key=${encodeURIComponent(firebaseConfig.apiKey)}` : ''}`;
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (res.status === 429) {
      handleFirestoreError({ code: 'resource-exhausted', status: 429 }, isRead);
      return null;
    }
    if (!res.ok && res.status >= 400) {
      try {
        const clone = res.clone();
        const errText = await clone.text();
        if (errText.includes('RESOURCE_EXHAUSTED') || errText.includes('Quota exceeded')) {
          handleFirestoreError({ code: 'resource-exhausted', message: errText }, isRead);
          return null;
        }
      } catch {}
    }
    return res;
  } catch (err) {
    clearTimeout(timer);
    handleFirestoreError(err, isRead);
    return null;
  }
}

export function withFirestoreTimeout<T>(promise: Promise<T>, timeoutMs = 1500, isReadOperation = true): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Firestore SDK timeout'));
    }, timeoutMs);

    promise
      .then((val) => {
        clearTimeout(timer);
        resolve(val);
      })
      .catch((err) => {
        clearTimeout(timer);
        handleFirestoreError(err, isReadOperation);
        reject(err);
      });
  });
}

const LOCAL_STORAGE_SESSION_KEY = 'vault_firebase_session_v1';
const LOCAL_STORAGE_REGISTERED_USERS_KEY = 'vault_registered_accounts_v1';
const LOCAL_STORAGE_PROFILE_OVERRIDES_KEY = 'vault_profile_overrides_v1';

interface ProfileOverrideRecord {
  uid?: string;
  email?: string;
  displayName?: string;
  avatarUrl?: string;
  bio?: string;
  phone?: string;
  instagram?: string;
  customStatus?: string;
  updatedAt: string;
}

function getProfileOverridesMap(): Record<string, ProfileOverrideRecord> {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_PROFILE_OVERRIDES_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed;
    }
  } catch {}
  return {};
}

function saveProfileOverride(profile: UserProfile): void {
  try {
    if (!profile) return;
    const map = getProfileOverridesMap();
    const record: ProfileOverrideRecord = {
      uid: profile.uid,
      email: profile.email?.toLowerCase().trim(),
      displayName: profile.displayName,
      avatarUrl: profile.avatarUrl,
      bio: profile.bio ?? '',
      phone: profile.phone ?? '',
      instagram: profile.instagram ?? '',
      customStatus: profile.customStatus ?? '',
      updatedAt: profile.updatedAt || new Date().toISOString(),
    };
    if (record.email) {
      map[`email:${record.email}`] = record;
    }
    if (record.uid) {
      map[`uid:${record.uid}`] = record;
    }
    localStorage.setItem(LOCAL_STORAGE_PROFILE_OVERRIDES_KEY, JSON.stringify(map));
  } catch (e) {
    console.warn('Could not save profile override:', e);
  }
}

function applyProfileOverride<T extends Partial<UserProfile>>(profile: T): T {
  try {
    if (!profile) return profile;
    const map = getProfileOverridesMap();
    const emailKey = profile.email ? `email:${profile.email.toLowerCase().trim()}` : '';
    const uidKey = profile.uid ? `uid:${profile.uid}` : '';
    const byEmail = emailKey ? map[emailKey] : undefined;
    const byUid = uidKey ? map[uidKey] : undefined;

    let override = byEmail || byUid;
    if (byEmail && byUid) {
      const tEmail = new Date(byEmail.updatedAt || 0).getTime() || 0;
      const tUid = new Date(byUid.updatedAt || 0).getTime() || 0;
      override = tEmail >= tUid ? byEmail : byUid;
    }
    if (!override) return profile;

    const profTime = profile.updatedAt ? new Date(profile.updatedAt).getTime() || 0 : 0;
    const overTime = override.updatedAt ? new Date(override.updatedAt).getTime() || 0 : 0;

    if (overTime >= profTime) {
      return {
        ...profile,
        displayName: override.displayName || profile.displayName,
        avatarUrl: override.avatarUrl || profile.avatarUrl,
        bio: override.bio !== undefined ? override.bio : profile.bio,
        phone: override.phone !== undefined ? override.phone : profile.phone,
        instagram: override.instagram !== undefined ? override.instagram : profile.instagram,
        customStatus: override.customStatus !== undefined ? override.customStatus : profile.customStatus,
        updatedAt: override.updatedAt,
      };
    }
  } catch {}
  return profile;
}

export interface RegisteredAccountRecord {
  email: string;
  password: string;
  profile: UserProfile;
  registeredAt: string;
}

function hasValidPurchasedOrApprovedMembership(
  uid?: string,
  email?: string,
  prof?: Partial<UserProfile>
): boolean {
  try {
    if (uid && localStorage.getItem(`vault_purchased_membership_${uid}`) === 'true') {
      return true;
    }

    // Check if there is an approved receipt in localStorage for this user
    const rawReceipts = localStorage.getItem('vault_payment_receipts_v1');
    if (rawReceipts) {
      const parsed = JSON.parse(rawReceipts);
      if (Array.isArray(parsed)) {
        const cleanEmail = (email || prof?.email || '').toLowerCase().trim();
        const userReceipts = parsed
          .filter(
            (r: any) =>
              r &&
              ((uid && r.userId === uid) ||
                (cleanEmail && String(r.userEmail || '').toLowerCase().trim() === cleanEmail))
          )
          .sort(
            (a: any, b: any) =>
              new Date(b.reviewedAt || b.createdAt || 0).getTime() -
              new Date(a.reviewedAt || a.createdAt || 0).getTime()
          );

        if (userReceipts.length > 0 && userReceipts[0].status === 'approved') {
          if (uid) {
            localStorage.setItem(`vault_purchased_membership_${uid}`, 'true');
          }
          return true;
        }
      }
    }

    // Also trust active membership from Database/Firestore if it has real start & expiration dates and wasn't cancelled
    if (
      prof?.membershipStatus === 'active' &&
      prof?.membershipPlan &&
      prof?.subscribedAt &&
      prof?.membershipExpiresAt
    ) {
      const cancelledAt = uid ? localStorage.getItem(`vault_cancelled_at_${uid}`) : null;
      const isCancelledAfter =
        cancelledAt &&
        new Date(cancelledAt).getTime() >= new Date(prof.subscribedAt).getTime();
      if (!isCancelledAfter) {
        if (uid) {
          localStorage.setItem(`vault_purchased_membership_${uid}`, 'true');
        }
        return true;
      }
    }
  } catch {}
  return false;
}

function mergeAccountProfiles(
  firstProf: Partial<UserProfile> | undefined,
  secondProf: Partial<UserProfile> | undefined,
  isAdmin: boolean
): UserProfile {
  const firstTime = firstProf?.updatedAt ? new Date(firstProf.updatedAt).getTime() || 0 : 0;
  const secondTime = secondProf?.updatedAt ? new Date(secondProf.updatedAt).getTime() || 0 : 0;

  // Determine which profile has newer user edits (if neither has updatedAt, prefer firstProf which is local)
  const firstIsNewer = firstTime >= secondTime;
  const base = (
    firstIsNewer
      ? { ...(secondProf || {}), ...(firstProf || {}) }
      : { ...(firstProf || {}), ...(secondProf || {}) }
  ) as UserProfile;

  if (firstIsNewer && firstProf) {
    if (firstProf.displayName) base.displayName = firstProf.displayName;
    if (firstProf.avatarUrl) base.avatarUrl = firstProf.avatarUrl;
    if (firstProf.bio !== undefined) base.bio = firstProf.bio;
    if (firstProf.phone !== undefined) base.phone = firstProf.phone;
    if (firstProf.instagram !== undefined) base.instagram = firstProf.instagram;
    if (firstProf.customStatus !== undefined) base.customStatus = firstProf.customStatus;
    if (firstProf.updatedAt) base.updatedAt = firstProf.updatedAt;
  } else if (!firstIsNewer && secondProf) {
    if (secondProf.displayName) base.displayName = secondProf.displayName;
    if (secondProf.avatarUrl) base.avatarUrl = secondProf.avatarUrl;
    if (secondProf.bio !== undefined) base.bio = secondProf.bio;
    if (secondProf.phone !== undefined) base.phone = secondProf.phone;
    if (secondProf.instagram !== undefined) base.instagram = secondProf.instagram;
    if (secondProf.customStatus !== undefined) base.customStatus = secondProf.customStatus;
    if (secondProf.updatedAt) base.updatedAt = secondProf.updatedAt;
  }

  const firstActive = firstProf?.membershipStatus === 'active' && firstProf?.subscribedAt;
  const secondActive = secondProf?.membershipStatus === 'active' && secondProf?.subscribedAt;
  const explicitlyRejected = String(secondProf?.customStatus || '').startsWith('Membresía no aprobada:');

  if (firstActive && !secondActive && secondProf?.membershipStatus !== 'cancelled' && !explicitlyRejected) {
    base.membershipStatus = 'active';
    base.membershipPlan = firstProf.membershipPlan;
    base.subscribedAt = firstProf.subscribedAt;
    base.membershipExpiresAt = firstProf.membershipExpiresAt;
    base.lastPaymentAmount = firstProf.lastPaymentAmount;
    base.tier = isAdmin ? 'Bóveda Diamante' : 'Acceso VIP';
  } else if (secondActive) {
    base.membershipStatus = 'active';
    base.membershipPlan = secondProf.membershipPlan || firstProf?.membershipPlan;
    base.subscribedAt = secondProf.subscribedAt || firstProf?.subscribedAt;
    base.membershipExpiresAt = secondProf.membershipExpiresAt || firstProf?.membershipExpiresAt;
    base.lastPaymentAmount = secondProf.lastPaymentAmount ?? firstProf?.lastPaymentAmount;
    base.tier = isAdmin ? 'Bóveda Diamante' : 'Acceso VIP';
  }

  return applyProfileOverride(base);
}

export function getStoredRegisteredAccounts(): Record<string, RegisteredAccountRecord> {
  let accounts: Record<string, RegisteredAccountRecord> = {};
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_REGISTERED_USERS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) {
        accounts = parsed;
      }
    }
  } catch (e) {
    console.warn('Could not read registered accounts store:', e);
  }

  // Cuentas iniciales preconfiguradas con IDs de usuario estrictamente diferentes
  const defaultSeeds: Record<string, RegisteredAccountRecord> = {
    [INITIAL_ADMIN_USER.email.toLowerCase()]: {
      email: INITIAL_ADMIN_USER.email.toLowerCase(),
      password: ADMIN_SECURITY_KEY,
      profile: {
        ...INITIAL_ADMIN_USER,
        uid: 'admin_master_astro',
        role: 'admin',
        tier: 'Bóveda Diamante',
        bio: 'Administrador central de Bóveda App 66. Gestión de contenidos y verificaciones.',
        phone: '+54 9 11 6554-6038',
        customStatus: '🛡️ Modo Administrador',
      },
      registeredAt: '2025-01-01T00:00:00.000Z',
    },
    'cuentaninja989@gmail.com': {
      email: 'cuentaninja989@gmail.com',
      password: ADMIN_SECURITY_KEY,
      profile: {
        uid: 'admin_ninja_989',
        email: 'cuentaninja989@gmail.com',
        displayName: 'Administrador (Cuenta Ninja)',
        role: 'admin',
        joinedAt: '2025-01-15',
        tier: 'Bóveda Diamante',
        membershipStatus: 'none',
        avatarUrl: 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=150&auto=format&fit=crop&q=80',
        customStatus: '🛡️ Administrador Secundario',
      },
      registeredAt: '2025-01-15T00:00:00.000Z',
    },
    [INITIAL_MEMBER_USER.email.toLowerCase()]: {
      email: INITIAL_MEMBER_USER.email.toLowerCase(),
      password: 'password123',
      profile: {
        ...INITIAL_MEMBER_USER,
        uid: 'vip_user_449',
        role: 'vip_member',
        bio: 'Miembro VIP de la comunidad. Acceso a recursos exclusivos.',
        customStatus: '💎 Miembro VIP',
      },
      registeredAt: '2025-02-14T00:00:00.000Z',
    },
  };

  // Agregar semillas por defecto si no existen
  for (const [key, seed] of Object.entries(defaultSeeds)) {
    if (!accounts[key]) {
      accounts[key] = seed;
    }
  }

  // Migración única para reemplazar fechas simuladas antiguas (-30 días / -3 días) por la fecha exacta y real de inicio y vencimiento
  const REAL_DATES_MIGRATION_KEY = 'vault_real_membership_dates_v2';
  let needsRealDateMigration = false;
  try {
    needsRealDateMigration = localStorage.getItem(REAL_DATES_MIGRATION_KEY) !== 'true';
  } catch {}

  // Garantizar que solo los correos autorizados tengan rol admin, y ningún usuario regular pueda tener admin
  const seenUids = new Set<string>();
  let hasChanges = false;
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  for (const [, record] of Object.entries(accounts)) {
    if (!record || !record.profile) continue;

    record.profile = applyProfileOverride(record.profile);

    const isAllowedAdmin = isAuthorizedAdminEmail(record.email || record.profile.email);
    if (isAllowedAdmin && record.profile.role !== 'admin') {
      record.profile.role = 'admin';
      record.profile.tier = 'Bóveda Diamante';
      hasChanges = true;
    } else if (!isAllowedAdmin && record.profile.role === 'admin') {
      record.profile.role = 'vip_member';
      if (record.profile.tier === 'Bóveda Diamante') {
        record.profile.tier = 'Acceso VIP';
      }
      hasChanges = true;
    }

    const currentUid = record.profile.uid;
    // Si el ID está vacío o repetido por otro usuario, se genera un ID único e irrepetible
    if (!currentUid || seenUids.has(currentUid)) {
      const uniqueId = generateUniqueUserId(isAllowedAdmin ? 'admin' : 'usr');
      record.profile.uid = uniqueId;
      hasChanges = true;
    }
    seenUids.add(record.profile.uid);

    const prof = record.profile;
    const isExplicitlyPurchased = hasValidPurchasedOrApprovedMembership(prof.uid, record.email || prof.email, prof);

    if (!isExplicitlyPurchased) {
      if (prof.membershipPlan || prof.membershipStatus === 'active' || prof.subscribedAt || prof.membershipExpiresAt) {
        prof.membershipPlan = undefined;
        prof.membershipStatus = prof.membershipStatus === 'cancelled' ? 'cancelled' : 'none';
        prof.subscribedAt = undefined;
        prof.membershipExpiresAt = undefined;
        if (prof.role !== 'admin') {
          prof.tier = 'Invitado';
        }
        hasChanges = true;
      }
    } else if (prof.membershipStatus === 'active' && prof.membershipPlan) {
      const amountVal = Number(prof.lastPaymentAmount) || (prof.membershipPlan === 'annual' ? 12 : 1);
      const durationDays =
        amountVal >= 12
          ? Math.max(365, Math.round((amountVal / 12) * 365))
          : Math.max(1, Math.round(amountVal * 30));
      const durationMs = durationDays * 86400000;
      if (!prof.subscribedAt || !prof.membershipExpiresAt) {
        const startTime = prof.subscribedAt ? new Date(prof.subscribedAt).getTime() : nowMs;
        const validStartTime = isNaN(startTime) ? nowMs : startTime;
        prof.subscribedAt = new Date(validStartTime).toISOString();
        prof.membershipExpiresAt = new Date(validStartTime + durationMs).toISOString();
        hasChanges = true;
      }
    }
  }

  if (needsRealDateMigration || hasChanges) {
    try {
      localStorage.setItem(REAL_DATES_MIGRATION_KEY, 'true');
      const rawSession = localStorage.getItem(LOCAL_STORAGE_SESSION_KEY);
      if (rawSession) {
        const sessionUser = JSON.parse(rawSession) as UserProfile;
        if (sessionUser && sessionUser.email) {
          const emailKey = sessionUser.email.toLowerCase().trim();
          const isAllowedAdmin = isAuthorizedAdminEmail(emailKey);
          const updatedRecord = accounts[emailKey];
          if (updatedRecord && updatedRecord.profile) {
            const mergedSession = mergeAccountProfiles(sessionUser, updatedRecord.profile, isAllowedAdmin);
            updatedRecord.profile = mergedSession;
            localStorage.setItem(LOCAL_STORAGE_SESSION_KEY, JSON.stringify(mergedSession));
          }
        }
      }
    } catch {}
  }

  if (hasChanges || !localStorage.getItem(LOCAL_STORAGE_REGISTERED_USERS_KEY)) {
    try {
      localStorage.setItem(LOCAL_STORAGE_REGISTERED_USERS_KEY, JSON.stringify(accounts));
    } catch (e) {}
  }

  return accounts;
}

export function storeRegisteredAccount(record: RegisteredAccountRecord, persistRemote = false): void {
  try {
    const accounts = getStoredRegisteredAccounts();
    const emailKey = record.email.toLowerCase().trim();
    accounts[emailKey] = record;
    localStorage.setItem(LOCAL_STORAGE_REGISTERED_USERS_KEY, JSON.stringify(accounts));
  } catch (e) {
    console.warn('Could not persist registered account locally:', e);
  }
  if (persistRemote) {
    try {
      firebaseService.saveUserAccountToDatabase(record).catch(() => {});
    } catch {}
  }
}

export const firebaseService = {
  // Save active session locally for instant offline/reloads
  saveSession(user: UserProfile | null): void {
    try {
      if (user) {
        const isAllowedAdmin = isAuthorizedAdminEmail(user.email);
        const sanitizedUser: UserProfile = {
          ...user,
          role: isAllowedAdmin ? 'admin' : 'vip_member',
          tier: isAllowedAdmin ? 'Bóveda Diamante' : (user.tier === 'Bóveda Diamante' ? 'Acceso VIP' : user.tier),
        };
        localStorage.setItem(LOCAL_STORAGE_SESSION_KEY, JSON.stringify(sanitizedUser));
      } else {
        localStorage.removeItem(LOCAL_STORAGE_SESSION_KEY);
      }
    } catch (e) {
      console.warn('LocalStorage save error:', e);
    }
  },

  // Obtener todas las cuentas registradas en el dispositivo
  getRegisteredAccounts(): Record<string, RegisteredAccountRecord> {
    return getStoredRegisteredAccounts();
  },

  // Obtener array de todos los perfiles registrados
  getAllRegisteredUsers(): UserProfile[] {
    const accounts = getStoredRegisteredAccounts();
    return Object.values(accounts).map((acc) => acc.profile);
  },

  // Helper para sanitizar un registro de cuenta antes de enviarlo a Firestore
  sanitizeUserRecordForFirestore(record: RegisteredAccountRecord): Record<string, any> {
    const prof = record.profile || ({} as UserProfile);
    const email = (record.email || prof.email || '').toLowerCase().trim();
    const isAdmin = isAuthorizedAdminEmail(email);
    const uid = prof.uid || generateUniqueUserId(isAdmin ? 'admin' : 'usr');

    const clean: Record<string, any> = {
      uid: String(uid),
      email: String(email),
      password: String(record.password || 'password123'),
      registeredAt: String(record.registeredAt || new Date().toISOString()),
      displayName: String(prof.displayName || email.split('@')[0] || 'Usuario'),
      role: isAdmin ? 'admin' : 'vip_member',
      tier: isAdmin ? 'Bóveda Diamante' : (prof.tier === 'Bóveda Diamante' ? 'Acceso VIP' : (prof.tier || 'Invitado')),
      avatarUrl: prof.avatarUrl || `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(uid)}`,
      joinedAt: prof.joinedAt || new Date().toISOString().split('T')[0],
      bio: prof.bio ?? '',
      phone: prof.phone ?? '',
      customStatus: prof.customStatus ?? '',
      instagram: prof.instagram ?? '',
      updatedAt: prof.updatedAt || new Date().toISOString(),
      membershipPlan: prof.membershipPlan || null,
      membershipStatus: prof.membershipStatus || 'none',
      subscribedAt: prof.subscribedAt || null,
      membershipExpiresAt: prof.membershipExpiresAt || null,
      lastPaymentAmount: typeof prof.lastPaymentAmount === 'number' ? prof.lastPaymentAmount : null,
    };

    Object.keys(clean).forEach((k) => {
      if (clean[k] === undefined) {
        delete clean[k];
      }
    });

    return clean;
  },

  // Guardar cuenta de usuario en Firestore mediante REST API (respaldo directo garantizado)
  async saveUserToFirestoreREST(record: RegisteredAccountRecord): Promise<boolean> {
    if (isFirestoreQuotaExhausted()) return false;
    try {
      const clean = this.sanitizeUserRecordForFirestore(record);
      if (!clean.uid || !clean.email) return false;

      const fields: Record<string, any> = {};
      for (const [key, value] of Object.entries(clean)) {
        if (value === undefined || value === null) continue;
        if (typeof value === 'string') {
          fields[key] = { stringValue: value };
        } else if (typeof value === 'number') {
          fields[key] = { integerValue: String(Math.round(value)) };
        } else if (typeof value === 'boolean') {
          fields[key] = { booleanValue: value };
        }
      }
      fields.updatedAt = { stringValue: new Date().toISOString() };

      const res = await firestoreRestFetch(`/users/${encodeURIComponent(clean.uid)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields }),
      });
      return Boolean(res && res.ok);
    } catch {
      return false;
    }
  },

  async saveUsersRegistryToFirestore(accountsMap: Record<string, RegisteredAccountRecord>): Promise<boolean> {
    if (isFirestoreQuotaExhausted()) return false;
    try {
      const compactMap: Record<string, any> = {};
      for (const [k, v] of Object.entries(accountsMap || {})) {
        if (!v) continue;
        const prof = v.profile || ({} as any);
        compactMap[k] = {
          ...v,
          profile: {
            ...prof,
            avatarUrl:
              prof.avatarUrl && String(prof.avatarUrl).length > 120000
                ? `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(prof.uid || k)}`
                : prof.avatarUrl,
          },
        };
      }
      const serialized = JSON.stringify(compactMap);
      const res = await firestoreRestFetch('/system_config/users_registry', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fields: {
            usersJson: { stringValue: serialized },
            updatedAt: { stringValue: new Date().toISOString() },
          },
        }),
      });
      return Boolean(res && res.ok);
    } catch {
      return false;
    }
  },

  // Guardar una cuenta registrada en la Base de Datos (Firestore REST + Servidor Central)
  async saveUserAccountToDatabase(record: RegisteredAccountRecord): Promise<boolean> {
    if (!record || (!record.email && !record.profile?.email)) return false;

    const emailKey = (record.email || record.profile.email).toLowerCase().trim();
    const isAdmin = isAuthorizedAdminEmail(emailKey);
    const uid = record.profile?.uid || generateUniqueUserId(isAdmin ? 'admin' : 'usr');

    const normalizedRecord: RegisteredAccountRecord = {
      email: emailKey,
      password: record.password || 'password123',
      registeredAt: record.registeredAt || new Date().toISOString(),
      profile: {
        ...record.profile,
        uid,
        email: emailKey,
        role: isAdmin ? 'admin' : 'vip_member',
        tier: isAdmin
          ? 'Bóveda Diamante'
          : record.profile?.tier === 'Bóveda Diamante'
          ? 'Acceso VIP'
          : record.profile?.tier || 'Invitado',
      },
    };

    // 1. Asegurar persistencia en localStorage
    try {
      const raw = localStorage.getItem(LOCAL_STORAGE_REGISTERED_USERS_KEY);
      const currentAccounts = raw ? JSON.parse(raw) : {};
      currentAccounts[emailKey] = normalizedRecord;
      localStorage.setItem(LOCAL_STORAGE_REGISTERED_USERS_KEY, JSON.stringify(currentAccounts));
    } catch {}

    let saved = false;

    // 2. Guardar en servidor central si está disponible (/api/vault/users)
    try {
      const res = await safeFetchApi('/api/vault/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(normalizedRecord),
      }, 2000);
      if (res && res.ok) saved = true;
    } catch (e) {
      console.warn('Server /api/vault/users save fallback:', e);
    }

    // 3. Guardar en Firestore mediante REST (solo si hay cuota disponible y el servidor no lo sincronizó ya)
    if (!saved && !isFirestoreQuotaExhausted()) {
      const restOk = await this.saveUserToFirestoreREST(normalizedRecord);
      if (restOk) saved = true;
      try {
        const raw = localStorage.getItem(LOCAL_STORAGE_REGISTERED_USERS_KEY);
        if (raw && !isFirestoreQuotaExhausted()) {
          this.saveUsersRegistryToFirestore(JSON.parse(raw)).catch(() => {});
        }
      } catch {}
    }

    return saved;
  },

  // Obtener todas las cuentas registradas desde la Base de Datos (Servidor + Firestore users_registry)
  async fetchUsersFromDatabase(): Promise<Record<string, RegisteredAccountRecord>> {
    const dbAccounts: Record<string, RegisteredAccountRecord> = {};

    const mergeRecord = (rec: RegisteredAccountRecord) => {
      if (!rec || (!rec.email && !rec.profile?.email)) return;
      const emailKey = (rec.email || rec.profile.email).toLowerCase().trim();
      if (!emailKey) return;
      const isAdmin = isAuthorizedAdminEmail(emailKey);
      const existing = dbAccounts[emailKey];
      const mergedProf = mergeAccountProfiles(existing?.profile, rec.profile, isAdmin);
      dbAccounts[emailKey] = {
        email: emailKey,
        password:
          rec.password && rec.password !== 'password123'
            ? rec.password
            : existing?.password || rec.password || 'password123',
        registeredAt: rec.registeredAt || existing?.registeredAt || new Date().toISOString(),
        profile: {
          ...mergedProf,
          email: emailKey,
          role: isAdmin ? 'admin' : 'vip_member',
          tier: isAdmin
            ? 'Bóveda Diamante'
            : mergedProf.tier === 'Bóveda Diamante'
            ? 'Acceso VIP'
            : mergedProf.tier || 'Invitado',
        },
      };
    };

    // 1. Consultar Servidor Central si está disponible (/api/vault/users)
    try {
      const res = await safeFetchApi('/api/vault/users', {}, 2000);
      if (res && res.ok) {
        const json = await res.json();
        if (json && json.accounts && typeof json.accounts === 'object') {
          for (const rec of Object.values(json.accounts) as RegisteredAccountRecord[]) {
            mergeRecord(rec);
          }
        }
      }
    } catch (e) {}

    // 2. Consultar documento único system_config/users_registry en Firestore (SDK + REST)
    if (!isFirestoreReadQuotaExhausted()) {
      let loadedFromSdk = false;
      try {
        const regSnap = await withFirestoreTimeout(getDoc(doc(db, 'system_config', 'users_registry')), 1500, true);
        if (regSnap.exists()) {
          const data = regSnap.data() as any;
          if (data?.usersJson) {
            const parsed = JSON.parse(data.usersJson);
            if (parsed && typeof parsed === 'object') {
              for (const rec of Object.values(parsed) as RegisteredAccountRecord[]) {
                mergeRecord(rec);
              }
              loadedFromSdk = true;
            }
          }
        }
      } catch (sdkErr) {
        handleFirestoreError(sdkErr, true);
      }

      if (!loadedFromSdk && !isFirestoreReadQuotaExhausted()) {
        try {
          const url = `${FIRESTORE_REST_BASE}/system_config/users_registry?key=${firebaseConfig.apiKey}`;
          const res = await fetch(url);
          if (res.status === 429) {
            handleFirestoreError({ code: 'resource-exhausted' }, true);
          } else if (res.ok) {
            const data: any = await res.json();
            const rawJson = data?.fields?.usersJson?.stringValue;
            if (rawJson) {
              const parsed = JSON.parse(rawJson);
              if (parsed && typeof parsed === 'object') {
                for (const rec of Object.values(parsed) as RegisteredAccountRecord[]) {
                  mergeRecord(rec);
                }
              }
            }
          }
        } catch {}
      }
    }

    return dbAccounts;
  },

  // Sincronizar TODAS las cuentas registradas (existentes en el dispositivo + sesión actual + base de datos)
  async syncAllRegisteredAccountsToDatabase(): Promise<Record<string, RegisteredAccountRecord>> {
    const localAccounts = getStoredRegisteredAccounts();

    // Asegurar que si hay una sesión activa en localStorage, también esté incluida en las cuentas registradas
    try {
      const activeSession = this.getLocalSession();
      if (activeSession && activeSession.email) {
        const sessionEmail = activeSession.email.toLowerCase().trim();
        const isAdmin = isAuthorizedAdminEmail(sessionEmail);
        if (!localAccounts[sessionEmail]) {
          localAccounts[sessionEmail] = {
            email: sessionEmail,
            password: isAdmin ? ADMIN_SECURITY_KEY : 'password123',
            registeredAt: new Date().toISOString(),
            profile: activeSession,
          };
        } else {
          localAccounts[sessionEmail].profile = mergeAccountProfiles(
            localAccounts[sessionEmail].profile,
            activeSession,
            isAdmin
          );
        }
      }
    } catch {}

    // 1. Enviar todas las cuentas locales al servidor central si está disponible (/api/vault/users/sync)
    try {
      const res = await safeFetchApi('/api/vault/users/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accounts: localAccounts }),
      }, 2000);
      if (res && res.ok) {
        const json = await res.json();
        if (json && json.accounts && typeof json.accounts === 'object') {
          for (const [emailKey, serverRec] of Object.entries(json.accounts) as [string, RegisteredAccountRecord][]) {
            const existing = localAccounts[emailKey];
            const isAdmin = isAuthorizedAdminEmail(emailKey);
            if (!existing) {
              localAccounts[emailKey] = serverRec;
            } else {
              localAccounts[emailKey] = {
                ...serverRec,
                ...existing,
                password:
                  existing.password && existing.password !== 'password123'
                    ? existing.password
                    : serverRec.password || existing.password || 'password123',
                profile: mergeAccountProfiles(existing.profile, serverRec.profile, isAdmin),
              };
            }
          }
        }
      }
    } catch (e) {
      console.warn('Could not batch sync users with server:', e);
    }

    // 2. Traer también cualquier cuenta directamente desde Firestore y fusionar
    try {
      const remoteAccounts = await this.fetchUsersFromDatabase();
      for (const [emailKey, remoteRec] of Object.entries(remoteAccounts) as [string, RegisteredAccountRecord][]) {
        const existing = localAccounts[emailKey];
        const isAdmin = isAuthorizedAdminEmail(emailKey);
        if (!existing) {
          localAccounts[emailKey] = remoteRec;
        } else {
          localAccounts[emailKey] = {
            ...remoteRec,
            ...existing,
            password:
              existing.password && existing.password !== 'password123'
                ? existing.password
                : remoteRec.password || existing.password || 'password123',
            profile: mergeAccountProfiles(existing.profile, remoteRec.profile, isAdmin),
          };
        }
      }
    } catch {}

    // 3. Guardar el mapa completo fusionado en localStorage y actualizar sesión activa si cambió su membresía
    try {
      localStorage.setItem(LOCAL_STORAGE_REGISTERED_USERS_KEY, JSON.stringify(localAccounts));
      const rawSession = localStorage.getItem(LOCAL_STORAGE_SESSION_KEY);
      if (rawSession) {
        const sessionUser = JSON.parse(rawSession) as UserProfile;
        if (sessionUser?.email) {
          const matched = localAccounts[sessionUser.email.toLowerCase().trim()];
          if (matched?.profile) {
            this.saveSession(matched.profile);
            window.dispatchEvent(new CustomEvent('vault_profile_updated', { detail: { profile: matched.profile } }));
          }
        }
      }
    } catch {}

    return localAccounts;
  },

  // Listener en tiempo real para cuentas de usuarios en Firestore (mediante documento maestro system_config/users_registry)
  onUsersSnapshot(callback: (accounts: Record<string, RegisteredAccountRecord>) => void) {
    if (isFirestoreReadQuotaExhausted()) return () => {};
    try {
      const regDocRef = doc(db, 'system_config', 'users_registry');
      let unsub: (() => void) | null = null;
      unsub = onSnapshot(
        regDocRef,
        (docSnap) => {
          if (docSnap.exists()) {
            const rawData = docSnap.data() as any;
            if (!rawData?.usersJson) return;
            let remoteMap: Record<string, RegisteredAccountRecord> = {};
            try {
              remoteMap = JSON.parse(rawData.usersJson);
            } catch {
              return;
            }
            if (!remoteMap || typeof remoteMap !== 'object') return;

            const currentAccounts = getStoredRegisteredAccounts();
            let updated = false;

            for (const [key, remoteRec] of Object.entries(remoteMap)) {
              const prof = remoteRec?.profile || (remoteRec as any);
              const email = (remoteRec?.email || prof?.email || key || '').toLowerCase().trim();
              if (!email) continue;
              const isAdmin = isAuthorizedAdminEmail(email);
              const existing = currentAccounts[email];
              const uid = prof?.uid || existing?.profile?.uid || generateUniqueUserId(isAdmin ? 'admin' : 'usr');

              const mergedProfile = mergeAccountProfiles(existing?.profile, prof, isAdmin);
              const isPurchasedOrApproved = hasValidPurchasedOrApprovedMembership(uid, email, mergedProfile);
              const activeStatus =
                isPurchasedOrApproved && mergedProfile.membershipStatus === 'active'
                  ? 'active'
                  : isPurchasedOrApproved
                  ? (mergedProfile.membershipStatus ?? 'none')
                  : 'none';

              const finalProfile: UserProfile = applyProfileOverride({
                ...mergedProfile,
                uid,
                email,
                role: isAdmin ? 'admin' : 'vip_member',
                tier: isAdmin
                  ? 'Bóveda Diamante'
                  : activeStatus === 'active'
                  ? 'Acceso VIP'
                  : mergedProfile.tier === 'Bóveda Diamante'
                  ? 'Invitado'
                  : mergedProfile.tier || 'Invitado',
                membershipStatus: activeStatus,
                membershipPlan: isPurchasedOrApproved ? mergedProfile.membershipPlan : undefined,
                subscribedAt: isPurchasedOrApproved ? mergedProfile.subscribedAt : undefined,
                membershipExpiresAt: isPurchasedOrApproved ? mergedProfile.membershipExpiresAt : undefined,
                lastPaymentAmount: isPurchasedOrApproved ? mergedProfile.lastPaymentAmount : undefined,
              });

              currentAccounts[email] = {
                email,
                password:
                  existing?.password && existing.password !== 'password123'
                    ? existing.password
                    : remoteRec?.password || existing?.password || 'password123',
                registeredAt: existing?.registeredAt || remoteRec?.registeredAt || new Date().toISOString(),
                profile: finalProfile,
              };
              updated = true;
            }

            if (updated) {
              try {
                localStorage.setItem(LOCAL_STORAGE_REGISTERED_USERS_KEY, JSON.stringify(currentAccounts));
              } catch {}
              callback(currentAccounts);
            }
          }
        },
        (err) => {
          handleFirestoreError(err);
          if (unsub) {
            try { unsub(); } catch {}
          }
        }
      );
      return () => {
        if (unsub) {
          try { unsub(); } catch {}
        }
      };
    } catch (err) {
      handleFirestoreError(err);
      return () => {};
    }
  },

  // Cambiar rápidamente entre cuentas registradas para probar diferentes perfiles
  switchAccount(email: string): UserProfile | null {
    const accounts = getStoredRegisteredAccounts();
    const normalized = email.toLowerCase().trim();
    const record = accounts[normalized];
    if (record && record.profile) {
      const prof = applyProfileOverride(record.profile);
      this.saveSession(prof);
      window.dispatchEvent(new CustomEvent('vault_profile_updated', { detail: { profile: prof } }));
      return prof;
    }
    return null;
  },

  // Actualizar perfil de un usuario garantizando persistencia local, en servidor y en Firestore
  async updateUserProfile(profile: UserProfile): Promise<void> {
    const nowIso = new Date().toISOString();
    const stampedProfile: UserProfile = {
      ...profile,
      updatedAt: profile.updatedAt || nowIso,
    };

    // 1. Guardar inmediatamente en el almacén dedicado de overrides y en la sesión activa
    saveProfileOverride(stampedProfile);
    this.saveSession(stampedProfile);

    // 2. Actualizar Firebase Auth profile si hay usuario autenticado
    try {
      if (auth.currentUser && stampedProfile.displayName) {
        updateProfile(auth.currentUser, {
          displayName: stampedProfile.displayName,
        }).catch(() => {});
      }
    } catch {}

    // 3. Persistir de forma individual en el registro de cuentas y en el servidor/Firestore
    let targetRecord: RegisteredAccountRecord | null = null;
    try {
      const accounts = getStoredRegisteredAccounts();
      const emailKey = stampedProfile.email.toLowerCase().trim();
      let matchedKey: string | null = null;

      if (accounts[emailKey]) {
        matchedKey = emailKey;
      } else {
        for (const [key, record] of Object.entries(accounts)) {
          if (record.profile?.uid === stampedProfile.uid) {
            matchedKey = key;
            break;
          }
        }
      }

      if (matchedKey && accounts[matchedKey]) {
        accounts[matchedKey].profile = {
          ...accounts[matchedKey].profile,
          ...stampedProfile,
          updatedAt: stampedProfile.updatedAt,
        };
        targetRecord = accounts[matchedKey];
        localStorage.setItem(LOCAL_STORAGE_REGISTERED_USERS_KEY, JSON.stringify(accounts));
      } else if (emailKey) {
        const newRecord: RegisteredAccountRecord = {
          email: emailKey,
          password: 'password123',
          profile: { ...stampedProfile },
          registeredAt: nowIso,
        };
        accounts[emailKey] = newRecord;
        targetRecord = newRecord;
        localStorage.setItem(LOCAL_STORAGE_REGISTERED_USERS_KEY, JSON.stringify(accounts));
      }
    } catch (e) {
      console.warn('Local account store update error:', e);
    }

    // Re-afirmar la sesión local después de getStoredRegisteredAccounts
    this.saveSession(stampedProfile);

    // Notificar reactivamente a la UI de inmediato
    window.dispatchEvent(new CustomEvent('vault_profile_updated', { detail: { profile: stampedProfile } }));

    // 4. Sincronizar con Base de Datos (con timeout rápido para no bloquear la UI)
    if (targetRecord) {
      try {
        await Promise.race([
          this.saveUserAccountToDatabase(targetRecord),
          new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 1500)),
        ]);
      } catch (e) {
        console.warn('Background database profile sync warning:', e);
      }
    }
  },

  // Activar o mejorar la membresía de un usuario por su UID o Email dependiendo del monto establecido por el usuario
  upgradeUserMembershipByUidOrEmail(
    uid: string, 
    email?: string, 
    plan?: MembershipPlanType,
    customStartDateIso?: string,
    amount?: number,
    customExpiresAtIso?: string
  ): UserProfile | null {
    // Marcar compra/aprobación antes de leer cuentas para que getStoredRegisteredAccounts no limpie el estado activo
    try {
      if (uid) {
        localStorage.removeItem(`vault_cancelled_at_${uid}`);
        localStorage.setItem(`vault_purchased_membership_${uid}`, 'true');
      }
    } catch {}

    const accounts = getStoredRegisteredAccounts();
    let foundKey: string | null = null;

    if (email && accounts[email.toLowerCase().trim()]) {
      foundKey = email.toLowerCase().trim();
    } else {
      for (const [key, record] of Object.entries(accounts)) {
        if (record.profile?.uid === uid) {
          foundKey = key;
          break;
        }
      }
    }

    const rawAmount = Number(amount);
    const resolvedAmount =
      !isNaN(rawAmount) && rawAmount > 0
        ? Math.round(rawAmount * 100) / 100
        : plan === 'annual'
        ? 12
        : 1;

    const resolvedPlan: MembershipPlanType = resolvedAmount >= 12 ? 'annual' : 'monthly';
    const durationDays =
      resolvedAmount >= 12
        ? Math.max(365, Math.round((resolvedAmount / 12) * 365))
        : Math.max(1, Math.round(resolvedAmount * 30));

    const startD = customStartDateIso ? new Date(customStartDateIso) : new Date();
    const validStartD = isNaN(startD.getTime()) ? new Date() : startD;
    const subscribedAtIso = validStartD.toISOString();
    const expiresAtIso =
      customExpiresAtIso && !isNaN(new Date(customExpiresAtIso).getTime())
        ? new Date(customExpiresAtIso).toISOString()
        : new Date(validStartD.getTime() + durationDays * 24 * 60 * 60 * 1000).toISOString();

    let updatedProf: UserProfile | null = null;

    if (foundKey && accounts[foundKey]) {
      const existingCustomStatus = accounts[foundKey].profile.customStatus;
      const cleanedCustomStatus =
        existingCustomStatus && existingCustomStatus.startsWith('Membresía no aprobada:')
          ? undefined
          : existingCustomStatus;

      updatedProf = {
        ...accounts[foundKey].profile,
        membershipPlan: resolvedPlan,
        membershipStatus: 'active',
        tier: accounts[foundKey].profile.role === 'admin' ? 'Bóveda Diamante' : 'Acceso VIP',
        subscribedAt: subscribedAtIso,
        membershipExpiresAt: expiresAtIso,
        lastPaymentAmount: resolvedAmount,
        customStatus: cleanedCustomStatus,
      };
      accounts[foundKey].profile = updatedProf;
      localStorage.setItem(LOCAL_STORAGE_REGISTERED_USERS_KEY, JSON.stringify(accounts));
    } else if (email || uid) {
      const normalizedEmail = (email || `${uid}@vault.user`).toLowerCase().trim();
      const isUserAdmin = isAuthorizedAdminEmail(normalizedEmail);
      updatedProf = {
        uid: uid || generateUniqueUserId('usr'),
        email: normalizedEmail,
        displayName: normalizedEmail.split('@')[0] || 'Miembro VIP',
        role: isUserAdmin ? 'admin' : 'vip_member',
        tier: isUserAdmin ? 'Bóveda Diamante' : 'Acceso VIP',
        joinedAt: validStartD.toISOString().split('T')[0],
        membershipPlan: resolvedPlan,
        membershipStatus: 'active',
        subscribedAt: subscribedAtIso,
        membershipExpiresAt: expiresAtIso,
        lastPaymentAmount: resolvedAmount,
      };
      accounts[normalizedEmail] = {
        email: normalizedEmail,
        password: 'password123',
        profile: updatedProf,
        registeredAt: subscribedAtIso,
      };
      localStorage.setItem(LOCAL_STORAGE_REGISTERED_USERS_KEY, JSON.stringify(accounts));
    }

    if (updatedProf) {
      try {
        localStorage.removeItem(`vault_cancelled_at_${updatedProf.uid}`);
        localStorage.setItem(`vault_purchased_membership_${updatedProf.uid}`, 'true');
      } catch {}

      const currentSession = this.getLocalSession();
      if (
        currentSession &&
        (currentSession.uid === uid ||
          currentSession.uid === updatedProf.uid ||
          (email && currentSession.email.toLowerCase() === email.toLowerCase().trim()))
      ) {
        this.saveSession(updatedProf);
        window.dispatchEvent(new CustomEvent('vault_profile_updated', { detail: { profile: updatedProf } }));
      }

      // Persistir también en la Base de Datos (Firestore + Servidor Central)
      const targetEmail = (foundKey || email || updatedProf.email || '').toLowerCase().trim();
      const targetRecord = accounts[targetEmail] || {
        email: targetEmail,
        password: 'password123',
        profile: updatedProf,
        registeredAt: subscribedAtIso,
      };
      this.saveUserAccountToDatabase(targetRecord).catch(() => {});
    }

    return updatedProf;
  },

  // Sincronizar automáticamente las membresías aprobadas por el admin según el monto de cada comprobante
  reconcileApprovedReceiptsWithUsers(receipts: any[]): void {
    if (!Array.isArray(receipts) || receipts.length === 0) return;
    try {
      const accounts = getStoredRegisteredAccounts();
      let anyAccountChanged = false;

      // Agrupar comprobantes por usuario y tomar el más reciente revisado
      const byUser = new Map<string, any>();
      for (const r of receipts) {
        if (!r || (!r.userId && !r.userEmail)) continue;
        if (r.status !== 'approved' && r.status !== 'rejected') continue;
        const key = String(r.userEmail || r.userId).toLowerCase().trim();
        const existing = byUser.get(key);
        const rTime = new Date(r.reviewedAt || r.createdAt || 0).getTime();
        const exTime = existing ? new Date(existing.reviewedAt || existing.createdAt || 0).getTime() : 0;
        if (!existing || rTime >= exTime) {
          byUser.set(key, r);
        }
      }

      for (const latestRec of byUser.values()) {
        if (latestRec.status !== 'approved') continue;

        const emailKey = String(latestRec.userEmail || '').toLowerCase().trim();
        let matchedKey: string | null = emailKey && accounts[emailKey] ? emailKey : null;
        if (!matchedKey && latestRec.userId) {
          for (const [k, acc] of Object.entries(accounts)) {
            if (acc.profile?.uid === latestRec.userId) {
              matchedKey = k;
              break;
            }
          }
        }

        const targetUid =
          (matchedKey && accounts[matchedKey]?.profile?.uid) || latestRec.userId;
        const cancelledAt = targetUid ? localStorage.getItem(`vault_cancelled_at_${targetUid}`) : null;
        const recStartIso = latestRec.membershipStartsAt || latestRec.reviewedAt || latestRec.createdAt;
        if (
          cancelledAt &&
          recStartIso &&
          new Date(cancelledAt).getTime() > new Date(recStartIso).getTime()
        ) {
          continue;
        }

        const currentProf = matchedKey ? accounts[matchedKey]?.profile : null;
        const expectedAmount = Number(latestRec.amount) || (latestRec.plan === 'annual' ? 12 : 1);
        const expectedPlan: MembershipPlanType = expectedAmount >= 12 ? 'annual' : 'monthly';

        if (
          !currentProf ||
          currentProf.membershipStatus !== 'active' ||
          currentProf.membershipPlan !== expectedPlan ||
          currentProf.lastPaymentAmount !== expectedAmount
        ) {
          this.upgradeUserMembershipByUidOrEmail(
            latestRec.userId,
            latestRec.userEmail,
            expectedPlan,
            recStartIso,
            expectedAmount,
            latestRec.membershipExpiresAt
          );
          anyAccountChanged = true;
        }
      }

      if (anyAccountChanged) {
        const session = this.getLocalSession();
        if (session) {
          window.dispatchEvent(new CustomEvent('vault_profile_updated', { detail: { profile: session } }));
        }
      }
    } catch (e) {
      console.warn('Error reconciling approved receipts with users:', e);
    }
  },

  // Denegar o revocar membresía de un usuario
  denyOrRevokeUserMembershipByUidOrEmail(
    uid: string,
    email?: string,
    reason?: string
  ): UserProfile | null {
    const accounts = getStoredRegisteredAccounts();
    let foundKey: string | null = null;

    if (email && accounts[email.toLowerCase().trim()]) {
      foundKey = email.toLowerCase().trim();
    } else {
      for (const [key, record] of Object.entries(accounts)) {
        if (record.profile?.uid === uid) {
          foundKey = key;
          break;
        }
      }
    }

    if (foundKey && accounts[foundKey]) {
      const isUserAdmin = accounts[foundKey].profile.role === 'admin';
      try {
        localStorage.removeItem(`vault_purchased_membership_${accounts[foundKey].profile.uid}`);
      } catch {}
      const updatedProf: UserProfile = {
        ...accounts[foundKey].profile,
        membershipPlan: undefined,
        membershipStatus: 'none',
        tier: isUserAdmin ? 'Bóveda Diamante' : 'Invitado',
        subscribedAt: undefined,
        membershipExpiresAt: undefined,
        customStatus: reason ? `Membresía no aprobada: ${reason}` : undefined,
      };
      accounts[foundKey].profile = updatedProf;
      localStorage.setItem(LOCAL_STORAGE_REGISTERED_USERS_KEY, JSON.stringify(accounts));
      this.saveUserAccountToDatabase(accounts[foundKey]).catch(() => {});

      const currentSession = this.getLocalSession();
      if (currentSession && (currentSession.uid === uid || currentSession.email.toLowerCase() === accounts[foundKey].email.toLowerCase())) {
        this.saveSession(updatedProf);
        window.dispatchEvent(new CustomEvent('vault_profile_updated', { detail: { profile: updatedProf } }));
      }
      return updatedProf;
    }
    return null;
  },

  getLocalSession(): UserProfile | null {
    try {
      // Ejecutar registro de cuentas primero para aplicar migración de fechas reales si corresponde
      const accounts = getStoredRegisteredAccounts();
      const stored = localStorage.getItem(LOCAL_STORAGE_SESSION_KEY);
      if (stored) {
        let user = JSON.parse(stored) as UserProfile;
        if (user && typeof user === 'object') {
          user = applyProfileOverride(user);
          const emailKey = (user.email || '').toLowerCase().trim();
          const isAllowedAdmin = isAuthorizedAdminEmail(emailKey);
          if (emailKey && accounts[emailKey]?.profile) {
            user = mergeAccountProfiles(user, accounts[emailKey].profile, isAllowedAdmin);
          }

          let sessionChanged = false;
          if (!user.uid) {
            user.uid = generateUniqueUserId(isAllowedAdmin ? 'admin' : 'usr');
            sessionChanged = true;
          }
          if (isAllowedAdmin && user.role !== 'admin') {
            user.role = 'admin';
            user.tier = 'Bóveda Diamante';
            sessionChanged = true;
          } else if (!isAllowedAdmin && user.role === 'admin') {
            user.role = 'vip_member';
            if (user.tier === 'Bóveda Diamante') {
              user.tier = 'Acceso VIP';
            }
            sessionChanged = true;
          }
          const isExplicitlyPurchased = hasValidPurchasedOrApprovedMembership(user.uid, user.email, user);
          if (!isExplicitlyPurchased && (user.membershipPlan || user.membershipStatus === 'active')) {
            user.membershipPlan = undefined;
            user.membershipStatus = 'none';
            user.subscribedAt = undefined;
            user.membershipExpiresAt = undefined;
            if (user.role !== 'admin') {
              user.tier = 'Invitado';
            }
            sessionChanged = true;
          }
          if (sessionChanged) {
            this.saveSession(user);
          }
          return user;
        }
      }
    } catch (e) {
      console.warn('LocalStorage load error:', e);
    }
    return null;
  },

  // Map a Firebase Auth User + Firestore data into app's UserProfile
  async mapFirebaseUserToProfile(fbUser: FirebaseUser): Promise<UserProfile> {
    const email = (fbUser.email || '').toLowerCase().trim();
    const isAdmin = isAuthorizedAdminEmail(email);
    const userDocRef = doc(db, 'users', fbUser.uid);

    const tier: 'Bóveda Diamante' | 'Acceso VIP' | 'Invitado' = isAdmin ? 'Bóveda Diamante' : 'Invitado';
    const displayName = fbUser.displayName || (email.split('@')[0] ? email.split('@')[0] : 'Usuario');
    const nowIso = new Date().toISOString();

    let profile: UserProfile = {
      uid: fbUser.uid,
      email: email || 'user@vault.firebase',
      displayName,
      role: isAdmin ? 'admin' : 'vip_member',
      avatarUrl: fbUser.photoURL || `https://api.dicebear.com/7.x/bottts/svg?seed=${fbUser.uid}`,
      joinedAt: nowIso.split('T')[0],
      tier,
      membershipStatus: 'none',
    };

    // Check local profile & overrides first to retain customizations & exact real membership dates
    const localAccounts = getStoredRegisteredAccounts();
    const localMatch = localAccounts[email];
    if (localMatch && localMatch.profile) {
      profile = mergeAccountProfiles(localMatch.profile, profile, isAdmin);
    } else {
      profile = applyProfileOverride(profile);
    }

    // Non-blocking firestore read with timeout to prevent loading hangs
    if (!isFirestoreReadQuotaExhausted()) {
      const firestoreSyncPromise = (async () => {
        try {
          const snap = await Promise.race([
            getDoc(userDocRef),
            new Promise<null>((_, reject) => setTimeout(() => reject(new Error('timeout')), 1500))
          ]);
          if (snap && snap.exists()) {
            const data = snap.data() as any;
            const merged = mergeAccountProfiles(profile, data, isAdmin);
            Object.assign(profile, merged);
          } else if (!isFirestoreWriteQuotaExhausted()) {
            await this.saveUserToFirestoreREST({
              email: (fbUser.email || profile.email).toLowerCase().trim(),
              password: localMatch?.password || 'password123',
              profile,
              registeredAt: localMatch?.registeredAt || nowIso,
            });
          }
        } catch (err) {
          handleFirestoreError(err, true);
        }
      })();

      firestoreSyncPromise.catch(() => {});
    }
    storeRegisteredAccount({
      email: (fbUser.email || profile.email).toLowerCase().trim(),
      password: localMatch?.password || 'password123',
      profile,
      registeredAt: localMatch?.registeredAt || nowIso,
    });
    this.saveSession(profile);
    return profile;
  },

  // Firebase Email/Password Login (Only allows login if the user has already registered in local or remote database)
  async signInWithEmail(email: string, password: string): Promise<UserProfile> {
    const normalizedEmail = email.toLowerCase().trim();
    const cleanPassword = password.trim();

    try {
      const cred = await signInWithEmailAndPassword(auth, normalizedEmail, cleanPassword);
      const profile = await this.mapFirebaseUserToProfile(cred.user);
      await this.saveUserAccountToDatabase({
        email: normalizedEmail,
        password: cleanPassword,
        profile,
        registeredAt: new Date().toISOString(),
      });
      return profile;
    } catch (err: any) {
      let registeredAccounts = getStoredRegisteredAccounts();
      let existingRecord = registeredAccounts[normalizedEmail];

      // Si no está en localStorage, buscar en la base de datos (Firestore + Servidor)
      if (!existingRecord) {
        try {
          registeredAccounts = await this.syncAllRegisteredAccountsToDatabase();
          existingRecord = registeredAccounts[normalizedEmail];
        } catch {}
      }

      if (existingRecord) {
        if (existingRecord.password === cleanPassword) {
          const isAllowedAdmin = isAuthorizedAdminEmail(normalizedEmail);
          const safeProfile: UserProfile = {
            ...existingRecord.profile,
            role: isAllowedAdmin ? 'admin' : 'vip_member',
          };
          await this.saveUserAccountToDatabase({
            ...existingRecord,
            profile: safeProfile,
          });
          this.saveSession(safeProfile);
          return safeProfile;
        }
        const passError = new Error('Contraseña incorrecta. Por favor verifica tus datos.');
        (passError as any).code = 'auth/wrong-password';
        throw passError;
      }

      // If pre-configured admin email
      if (isAuthorizedAdminEmail(normalizedEmail) && cleanPassword === ADMIN_SECURITY_KEY) {
        let uniqueAdminUid = 'admin_master_astro';
        if (normalizedEmail.includes('ninja')) uniqueAdminUid = 'admin_ninja_989';
        else if (normalizedEmail.includes('vault.private')) uniqueAdminUid = 'admin_vault_private';
        else if (normalizedEmail.includes('creador')) uniqueAdminUid = 'admin_creador_ffx';

        const adminUser: UserProfile = {
          ...INITIAL_ADMIN_USER,
          uid: uniqueAdminUid,
          email: normalizedEmail,
          displayName: `Administrador (${normalizedEmail.split('@')[0]})`,
          role: 'admin',
        };
        storeRegisteredAccount({
          email: normalizedEmail,
          password: cleanPassword,
          profile: adminUser,
          registeredAt: new Date().toISOString(),
        });
        this.saveSession(adminUser);
        return adminUser;
      }

      if (
        err?.code === 'auth/user-not-found' ||
        err?.code === 'auth/wrong-password' ||
        err?.code === 'auth/invalid-credential' ||
        err?.code === 'auth/invalid-email'
      ) {
        const notFoundError = new Error('Esta cuenta no existe o la contraseña es incorrecta. Por favor regístrate primero.');
        (notFoundError as any).code = err.code;
        throw notFoundError;
      }

      const notRegError = new Error('Esta cuenta no está registrada. Por favor ve a la pestaña "Registrarse" para crear tu cuenta.');
      (notRegError as any).code = 'auth/user-not-found';
      throw notRegError;
    }
  },

  // Firebase Email/Password Register (Creates a new user account with unique user ID)
  async registerWithEmail(email: string, password: string, displayName?: string): Promise<UserProfile> {
    const normalizedEmail = email.toLowerCase().trim();
    const cleanPassword = password.trim();

    // Check local registry and remote database first
    let registeredAccounts = getStoredRegisteredAccounts();
    if (!registeredAccounts[normalizedEmail]) {
      try {
        const dbAccounts = await this.fetchUsersFromDatabase();
        if (dbAccounts[normalizedEmail]) {
          registeredAccounts[normalizedEmail] = dbAccounts[normalizedEmail];
        }
      } catch {}
    }
    if (registeredAccounts[normalizedEmail]) {
      const alreadyExistsError = new Error('Este correo ya está registrado. Por favor inicia sesión con tu contraseña.');
      (alreadyExistsError as any).code = 'auth/email-already-in-use';
      throw alreadyExistsError;
    }

    const isAdmin = isAuthorizedAdminEmail(normalizedEmail);
    // Generar ID de usuario único, diferente e irrepetible para cada usuario
    const uniqueUid = generateUniqueUserId(isAdmin ? 'admin' : 'usr');

    const newProfile: UserProfile = {
      uid: uniqueUid,
      email: normalizedEmail,
      displayName: displayName?.trim() || normalizedEmail.split('@')[0] || (isAdmin ? 'Administrador' : 'Usuario'),
      role: isAdmin ? 'admin' : 'vip_member',
      avatarUrl: `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(uniqueUid)}`,
      tier: isAdmin ? 'Bóveda Diamante' : 'Invitado',
      membershipStatus: 'none',
      joinedAt: new Date().toISOString().split('T')[0],
    };

    try {
      const cred = await createUserWithEmailAndPassword(auth, normalizedEmail, cleanPassword);
      if (displayName) {
        try {
          await updateProfile(cred.user, { displayName });
        } catch {}
      }
      if (cred && cred.user && cred.user.uid) {
        newProfile.uid = cred.user.uid;
        newProfile.avatarUrl = cred.user.photoURL || `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(cred.user.uid)}`;
      }
    } catch (err: any) {
      if (err?.code === 'auth/email-already-in-use') {
        throw err;
      }
      // If Firebase Auth operation fails or offline, newProfile uses the unique generated UID
      console.warn('Fallback registering user with unique local ID:', uniqueUid, err?.message);
    }

    const accountRecord: RegisteredAccountRecord = {
      email: normalizedEmail,
      password: cleanPassword,
      profile: newProfile,
      registeredAt: new Date().toISOString(),
    };

    // Persist in local registry + Database (Firestore Web SDK + Firestore REST + Server Database)
    storeRegisteredAccount(accountRecord);
    await this.saveUserAccountToDatabase(accountRecord);

    this.saveSession(newProfile);
    return newProfile;
  },

  // Firebase Google Popup Sign-in / Register
  async signInWithFirebaseGoogle(): Promise<UserProfile> {
    const cred = await signInWithPopup(auth, googleAuthProvider);
    return await this.mapFirebaseUserToProfile(cred.user);
  },

  // Direct Admin Access with Master Security Key
  async loginAsAdminWithKey(adminKey: string): Promise<UserProfile> {
    if (!isAuthorizedAdminKey(adminKey)) {
      throw new Error('Key de seguridad incorrecta. Se requiere la clave de Administrador.');
    }
    const currentSession = this.getLocalSession();
    if (currentSession && currentSession.role === 'admin' && currentSession.uid) {
      await this.saveUserAccountToDatabase({
        email: currentSession.email.toLowerCase().trim(),
        password: ADMIN_SECURITY_KEY,
        profile: currentSession,
        registeredAt: new Date().toISOString(),
      });
      return currentSession;
    }
    const accounts = getStoredRegisteredAccounts();
    const adminRecord = accounts[INITIAL_ADMIN_USER.email.toLowerCase()];
    if (adminRecord && adminRecord.profile) {
      await this.saveUserAccountToDatabase(adminRecord);
      this.saveSession(adminRecord.profile);
      return adminRecord.profile;
    }
    const adminUser = { ...INITIAL_ADMIN_USER };
    await this.saveUserAccountToDatabase({
      email: adminUser.email.toLowerCase().trim(),
      password: ADMIN_SECURITY_KEY,
      profile: adminUser,
      registeredAt: '2025-01-01T00:00:00.000Z',
    });
    this.saveSession(adminUser);
    return adminUser;
  },

  // Sign out from Firebase
  async signOut(): Promise<void> {
    this.saveSession(null);
    try {
      await signOut(auth);
    } catch (err) {
      console.warn('Firebase signout error:', err);
    }
  },

  // Real-time listener for Firebase Auth
  onAuthState(callback: (user: UserProfile | null) => void) {
    try {
      return onAuthStateChanged(
        auth,
        async (fbUser) => {
          try {
            if (fbUser) {
              const profile = await this.mapFirebaseUserToProfile(fbUser);
              callback(profile);
            } else {
              callback(this.getLocalSession());
            }
          } catch (e) {
            callback(this.getLocalSession());
          }
        },
        (error) => {
          console.warn('onAuthStateChanged error:', error);
          callback(this.getLocalSession());
        }
      );
    } catch (err) {
      callback(this.getLocalSession());
      return () => {};
    }
  },

  // Helper to sanitize items for Firestore (Firestore strictly forbids 'undefined' and max 1MB doc size)
  sanitizeItemForFirestore(item: VaultItem): Record<string, any> {
    // Firestore documents cannot exceed 1MB (1,048,576 bytes).
    // If base64 fileData is large (>500KB), keep it out of Firestore to prevent document size rejection.
    let safeFileData = '';
    if (item.fileData && typeof item.fileData === 'string' && item.fileData.length < 500000) {
      safeFileData = item.fileData;
    }

    const raw: Record<string, any> = {
      id: String(item.id || `vault-res-${Date.now()}`),
      title: String(item.title || '').trim(),
      description: String(item.description || '').trim(),
      category: item.category || 'code',
      fileType: item.fileType || '',
      fileSize: item.fileSize || '',
      fileName: item.fileName || '',
      fileMimeType: item.fileMimeType || '',
      fileData: safeFileData,
      downloadUrl: item.downloadUrl || '',
      coverImage: item.coverImage || 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=600&auto=format&fit=crop&q=80',
      createdAt: item.createdAt || new Date().toISOString().split('T')[0],
      likesCount: typeof item.likesCount === 'number' ? item.likesCount : 0,
      likedBy: Array.isArray(item.likedBy) ? item.likedBy.filter(Boolean) : [],
      comments: Array.isArray(item.comments) ? item.comments.filter(Boolean) : [],
      listIds: Array.isArray(item.listIds) ? item.listIds.filter(Boolean) : [],
      isLockedForTier: Boolean(item.isLockedForTier),
      version: item.version || 'v1.0',
      author: {
        name: item.author?.name || 'Administrador (astroarg02)',
        badge: item.author?.badge || 'ADMIN ROOT',
      },
    };

    // Remove any undefined keys
    Object.keys(raw).forEach((k) => {
      if (raw[k] === undefined) {
        delete raw[k];
      }
    });

    return raw;
  },

  // Helper to convert item into Firestore REST fields format
  itemToFirestoreRestFields(item: VaultItem): Record<string, any> {
    const clean = this.sanitizeItemForFirestore(item);
    const fields: Record<string, any> = {};

    for (const [key, value] of Object.entries(clean)) {
      if (value === undefined || value === null) continue;
      if (typeof value === 'string') {
        fields[key] = { stringValue: value };
      } else if (typeof value === 'number') {
        fields[key] = { integerValue: String(Math.round(value)) };
      } else if (typeof value === 'boolean') {
        fields[key] = { booleanValue: value };
      } else if (Array.isArray(value)) {
        fields[key] = {
          arrayValue: {
            values: value.map((v) => {
              if (typeof v === 'string') return { stringValue: v };
              if (typeof v === 'object') return { stringValue: JSON.stringify(v) };
              return { stringValue: String(v) };
            }),
          },
        };
      } else if (typeof value === 'object') {
        fields[key] = { stringValue: JSON.stringify(value) };
      }
    }
    return fields;
  },

  // Direct REST write to Firestore (stateless, never opens SDK Write stream or retry loops)
  async saveToFirestoreREST(item: VaultItem): Promise<boolean> {
    if (isFirestoreQuotaExhausted() || !item || !item.id) return false;
    try {
      const fields = this.itemToFirestoreRestFields(item);
      const res = await firestoreRestFetch(`/vault_items/${encodeURIComponent(item.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields }),
      });
      return Boolean(res && res.ok);
    } catch {
      return false;
    }
  },

  // Save or insert Vault Item in Firestore (so all users in any device see it)
  async saveVaultItemToFirestore(item: VaultItem): Promise<boolean> {
    if (!item || !item.id || isFirestoreQuotaExhausted()) return false;
    return await this.saveToFirestoreREST(item);
  },

  // Sync items to Firestore safely without overwhelming write streams
  async syncAllItemsToFirestore(items: VaultItem[]): Promise<number> {
    if (!Array.isArray(items) || items.length === 0 || isFirestoreQuotaExhausted()) return 0;
    let successCount = 0;
    const validItems = items.filter(
      (item) => item && item.id && !item.id.startsWith('res_00') && !item.id.startsWith('test-') && item.id !== 'vault-res-test-rest' && item.id !== 'vault-res-direct-1787703256063'
    );

    // Process sequentially in batches to prevent write stream exhaustion
    for (const item of validItems) {
      if (isFirestoreQuotaExhausted()) break;
      try {
        const ok = await this.saveVaultItemToFirestore(item);
        if (ok) successCount++;
      } catch {}
    }
    return successCount;
  },

  // Delete Vault Item from Firestore
  async deleteVaultItemFromFirestore(itemId: string): Promise<boolean> {
    if (!itemId || isFirestoreQuotaExhausted()) return false;
    try {
      const res = await firestoreRestFetch(`/vault_items/${encodeURIComponent(itemId)}`, {
        method: 'DELETE',
      });
      return Boolean(res && res.ok);
    } catch {
      return false;
    }
  },

  // Real-time listener for Firestore Vault Items
  onVaultItemsSnapshot(callback: (items: VaultItem[]) => void) {
    if (isFirestoreReadQuotaExhausted()) return () => {};
    try {
      const colRef = collection(db, 'vault_items');
      let unsub: (() => void) | null = null;
      unsub = onSnapshot(
        colRef,
        (snapshot) => {
          if (!snapshot.empty) {
            const items: VaultItem[] = [];
            snapshot.forEach((docSnap) => {
              if (docSnap.id.startsWith('res_00') || docSnap.id.startsWith('test-') || docSnap.id === 'vault-res-test-rest' || docSnap.id === 'vault-res-direct-1787703256063') {
                return;
              }
              const data = docSnap.data();
              items.push({
                id: docSnap.id,
                title: data.title || '',
                description: data.description || '',
                category: data.category || 'code',
                fileType: data.fileType || '',
                fileSize: data.fileSize || '',
                fileName: data.fileName || undefined,
                fileMimeType: data.fileMimeType || undefined,
                fileData: data.fileData || undefined,
                downloadUrl: data.downloadUrl || '',
                coverImage: data.coverImage || 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=600&auto=format&fit=crop&q=80',
                createdAt: data.createdAt || new Date().toISOString().split('T')[0],
                likesCount: typeof data.likesCount === 'number' ? data.likesCount : 0,
                likedBy: Array.isArray(data.likedBy) ? data.likedBy : [],
                comments: Array.isArray(data.comments) ? data.comments : [],
                listIds: Array.isArray(data.listIds) ? data.listIds : undefined,
                isLockedForTier: data.isLockedForTier ?? false,
                version: data.version || 'v1.0',
                author: data.author || {
                  name: 'Administrador (astroarg02)',
                  badge: 'ADMIN ROOT',
                },
              });
            });
            callback(items);
          }
        },
        (error) => {
          handleFirestoreError(error);
          if (unsub) {
            try { unsub(); } catch {}
          }
        }
      );
      return () => {
        if (unsub) {
          try { unsub(); } catch {}
        }
      };
    } catch (err) {
      handleFirestoreError(err);
      return () => {};
    }
  },

  // Update comments in Firestore via stateless REST
  async updateItemComments(itemId: string, comments: any[]): Promise<void> {
    if (!itemId || isFirestoreQuotaExhausted()) return;
    try {
      const values = (comments || []).map((c) => ({
        stringValue: typeof c === 'object' ? JSON.stringify(c) : String(c),
      }));
      await firestoreRestFetch(
        `/vault_items/${encodeURIComponent(itemId)}?updateMask.fieldPaths=comments`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fields: {
              comments: { arrayValue: { values } },
            },
          }),
        }
      );
    } catch {}
  },

  // Fetch Vault Items from Firestore with REST fallback
  async fetchVaultItems(): Promise<VaultItem[] | null> {
    if (isFirestoreReadQuotaExhausted()) return null;
    try {
      // 1. Try Web SDK
      const colRef = collection(db, 'vault_items');
      const snap = await withFirestoreTimeout(getDocs(colRef), 1500, true);
      if (!snap.empty) {
        const items: VaultItem[] = [];
        snap.forEach((docSnap) => {
          if (docSnap.id.startsWith('res_00') || docSnap.id.startsWith('test-') || docSnap.id === 'vault-res-test-rest' || docSnap.id === 'vault-res-direct-1787703256063') {
            return;
          }
          const data = docSnap.data();
          items.push({
            id: docSnap.id,
            title: data.title || '',
            description: data.description || '',
            category: data.category || 'code',
            fileType: data.fileType || '',
            fileSize: data.fileSize || '',
            fileName: data.fileName || undefined,
            fileMimeType: data.fileMimeType || undefined,
            fileData: data.fileData || undefined,
            downloadUrl: data.downloadUrl || '',
            coverImage: data.coverImage || 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=600&auto=format&fit=crop&q=80',
            createdAt: data.createdAt || new Date().toISOString().split('T')[0],
            likesCount: typeof data.likesCount === 'number' ? data.likesCount : 0,
            likedBy: Array.isArray(data.likedBy) ? data.likedBy : [],
            comments: Array.isArray(data.comments) ? data.comments : [],
            listIds: Array.isArray(data.listIds) ? data.listIds : undefined,
            isLockedForTier: data.isLockedForTier ?? false,
            version: data.version || 'v1.0',
            author: data.author || {
              name: 'Administrador (astroarg02)',
              badge: 'ADMIN ROOT',
            },
          });
        });
        return items;
      }
    } catch (e) {
      handleFirestoreError(e, true);
    }

    if (isFirestoreReadQuotaExhausted()) return null;

    // 2. REST Fallback
    try {
      const url = `${FIRESTORE_REST_BASE}/vault_items?key=${firebaseConfig.apiKey}&pageSize=300`;
      const res = await fetch(url);
      if (res.status === 429) {
        handleFirestoreError({ code: 'resource-exhausted' }, true);
        return null;
      }
      if (res.ok) {
        const data: any = await res.json();
        if (data && Array.isArray(data.documents) && data.documents.length > 0) {
          const items: VaultItem[] = data.documents
            .filter((docSnap: any) => {
              const id = docSnap.name.split('/').pop() || '';
              return !id.startsWith('res_00') && !id.startsWith('test-') && id !== 'vault-res-test-rest' && id !== 'vault-res-direct-1787703256063';
            })
            .map((docSnap: any) => {
            const fields = docSnap.fields || {};
            const id = docSnap.name.split('/').pop() || '';
            let author = { name: 'Administrador (astroarg02)', badge: 'ADMIN ROOT' };
            if (fields.author?.stringValue) {
              try {
                author = JSON.parse(fields.author.stringValue);
              } catch (err) {
                author = { name: fields.author.stringValue, badge: 'ADMIN ROOT' };
              }
            }
            let comments: any[] = [];
            if (fields.comments?.arrayValue?.values) {
              comments = fields.comments.arrayValue.values.map((v: any) => {
                try {
                  return JSON.parse(v.stringValue);
                } catch (err) {
                  return v.stringValue;
                }
              });
            }
            let likedBy: string[] = [];
            if (fields.likedBy?.arrayValue?.values) {
              likedBy = fields.likedBy.arrayValue.values.map((v: any) => v.stringValue).filter(Boolean);
            }
            let listIds: string[] | undefined = undefined;
            if (fields.listIds?.arrayValue?.values) {
              listIds = fields.listIds.arrayValue.values.map((v: any) => v.stringValue).filter(Boolean);
            }
            return {
              id,
              title: fields.title?.stringValue || '',
              description: fields.description?.stringValue || '',
              category: (fields.category?.stringValue as any) || 'code',
              fileType: fields.fileType?.stringValue || '',
              fileSize: fields.fileSize?.stringValue || '',
              fileName: fields.fileName?.stringValue || undefined,
              fileMimeType: fields.fileMimeType?.stringValue || undefined,
              fileData: fields.fileData?.stringValue || undefined,
              downloadUrl: fields.downloadUrl?.stringValue || '',
              coverImage: fields.coverImage?.stringValue || '',
              createdAt: fields.createdAt?.stringValue || new Date().toISOString().split('T')[0],
              likesCount: Number(fields.likesCount?.integerValue || 0),
              likedBy,
              comments,
              listIds,
              isLockedForTier: Boolean(fields.isLockedForTier?.booleanValue),
              version: fields.version?.stringValue || 'v1.0',
              author,
            };
          });
          return items;
        }
      }
    } catch (restErr) {
      console.warn('Firestore REST read error:', restErr);
    }

    return null;
  },

  // Update likes in Firestore via stateless REST
  async updateItemLikes(itemId: string, likesCount: number, likedBy: string[]): Promise<void> {
    if (!itemId || isFirestoreQuotaExhausted()) return;
    try {
      await firestoreRestFetch(
        `/vault_items/${encodeURIComponent(itemId)}?updateMask.fieldPaths=likesCount&updateMask.fieldPaths=likedBy`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fields: {
              likesCount: { integerValue: String(Math.round(likesCount)) },
              likedBy: {
                arrayValue: {
                  values: (likedBy || []).map((u) => ({ stringValue: String(u) })),
                },
              },
            },
          }),
        }
      );
    } catch {}
  },

  // Save or update Vault List in Firestore (both vault_lists/{id} and system_config/lists_registry) via stateless REST
  async saveVaultListToFirestore(list: VaultList, allLists?: VaultList[], deletedIds?: string[]): Promise<boolean> {
    if (!list || !list.id || isFirestoreQuotaExhausted()) return false;
    try {
      const cleanList = {
        id: String(list.id),
        name: String(list.name || '').trim(),
        description: String(list.description || '').trim(),
        icon: String(list.icon || 'folder'),
        color: String(list.color || '#0066FF'),
        itemIds: Array.isArray(list.itemIds) ? list.itemIds.filter(Boolean) : [],
        createdAt: list.createdAt || new Date().toISOString().split('T')[0],
        createdBy: list.createdBy || 'admin_master_astro',
      };

      const fields: Record<string, any> = {
        id: { stringValue: String(cleanList.id) },
        name: { stringValue: String(cleanList.name) },
        description: { stringValue: String(cleanList.description) },
        icon: { stringValue: String(cleanList.icon) },
        color: { stringValue: String(cleanList.color) },
        createdAt: { stringValue: String(cleanList.createdAt) },
        createdBy: { stringValue: String(cleanList.createdBy) },
        itemIds: {
          arrayValue: {
            values: cleanList.itemIds.map((id) => ({ stringValue: String(id) })),
          },
        },
      };

      const res = await firestoreRestFetch(`/vault_lists/${encodeURIComponent(list.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields }),
      });
      const saved = Boolean(res && res.ok);

      // Also persist the consolidated lists_registry in system_config if quota allows
      if (!isFirestoreQuotaExhausted()) {
        try {
          let listsToStore = allLists;
          if (!listsToStore) {
            const cached = localStorage.getItem('vault_lists_cache');
            if (cached) {
              const parsed = JSON.parse(cached);
              if (Array.isArray(parsed)) listsToStore = parsed;
            }
          }
          let delIdsToStore = deletedIds;
          if (!delIdsToStore) {
            const rawDel = localStorage.getItem('vault_deleted_list_ids');
            if (rawDel) {
              const parsedDel = JSON.parse(rawDel);
              if (Array.isArray(parsedDel)) delIdsToStore = parsedDel.filter((id: string) => id !== list.id);
            }
          }
          if (listsToStore) {
            const exists = listsToStore.some((l) => l.id === list.id);
            const mergedLists = exists
              ? listsToStore.map((l) => (l.id === list.id ? cleanList : l))
              : [...listsToStore, cleanList];
            await firestoreRestFetch('/system_config/lists_registry', {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                fields: {
                  listsJson: { stringValue: JSON.stringify(mergedLists) },
                  deletedIds: {
                    arrayValue: {
                      values: (delIdsToStore || []).map((id) => ({ stringValue: String(id) })),
                    },
                  },
                  updatedAt: { stringValue: new Date().toISOString() },
                },
              }),
            });
          }
        } catch {}
      }

      return saved;
    } catch {
      return false;
    }
  },

  // Delete Vault List from Firestore (and record deletion in system_config/lists_registry) via stateless REST
  async deleteVaultListFromFirestore(listId: string, remainingLists?: VaultList[], deletedIds?: string[]): Promise<boolean> {
    if (!listId || isFirestoreQuotaExhausted()) return false;
    try {
      await firestoreRestFetch(`/vault_lists/${encodeURIComponent(listId)}`, {
        method: 'DELETE',
      });

      if (!isFirestoreQuotaExhausted()) {
        try {
          let listsToStore = remainingLists;
          if (!listsToStore) {
            const cached = localStorage.getItem('vault_lists_cache');
            if (cached) {
              const parsed = JSON.parse(cached);
              if (Array.isArray(parsed)) listsToStore = parsed.filter((l: any) => l && l.id !== listId);
            }
          }
          let delIdsToStore = deletedIds;
          if (!delIdsToStore) {
            const rawDel = localStorage.getItem('vault_deleted_list_ids');
            const parsedDel = rawDel ? JSON.parse(rawDel) : [];
            const setDel = new Set<string>(Array.isArray(parsedDel) ? parsedDel : []);
            setDel.add(listId);
            delIdsToStore = Array.from(setDel);
          }
          await firestoreRestFetch('/system_config/lists_registry', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              fields: {
                listsJson: { stringValue: JSON.stringify(listsToStore || []) },
                deletedIds: {
                  arrayValue: {
                    values: (delIdsToStore || []).map((id) => ({ stringValue: String(id) })),
                  },
                },
                updatedAt: { stringValue: new Date().toISOString() },
              },
            }),
          });
        } catch {}
      }

      return true;
    } catch {
      return false;
    }
  },

  // Real-time listener for Firestore Vault Lists + Deleted Lists Registry
  onVaultListsSnapshot(callback: (lists: VaultList[], deletedIds?: string[]) => void) {
    if (isFirestoreReadQuotaExhausted()) return () => {};
    try {
      const colRef = collection(db, 'vault_lists');
      const regRef = doc(db, 'system_config', 'lists_registry');
      let unsubCol: (() => void) | null = null;
      let unsubReg: (() => void) | null = null;

      unsubReg = onSnapshot(
        regRef,
        (snap) => {
          if (snap.exists()) {
            const data = snap.data() as any;
            const deletedIds: string[] = Array.isArray(data.deletedIds) ? data.deletedIds.map(String) : [];
            if (deletedIds.length > 0) {
              try {
                const raw = localStorage.getItem('vault_deleted_list_ids');
                const set = new Set<string>(raw ? JSON.parse(raw) : []);
                deletedIds.forEach((id) => set.add(id));
                localStorage.setItem('vault_deleted_list_ids', JSON.stringify(Array.from(set)));
              } catch {}
            }
            if (data.listsJson) {
              try {
                const parsed = JSON.parse(data.listsJson);
                if (Array.isArray(parsed)) {
                  const delSet = new Set(deletedIds);
                  callback(parsed.filter((l: any) => l && l.id && !delSet.has(l.id)), deletedIds);
                }
              } catch {}
            }
          }
        },
        () => {}
      );

      unsubCol = onSnapshot(
        colRef,
        (snapshot) => {
          if (!snapshot.empty) {
            const lists: VaultList[] = [];
            snapshot.forEach((docSnap) => {
              const data = docSnap.data();
              lists.push({
                id: docSnap.id,
                name: data.name || 'Lista',
                description: data.description || '',
                icon: data.icon || 'folder',
                color: data.color || '#0066FF',
                itemIds: Array.isArray(data.itemIds) ? data.itemIds : [],
                createdAt: data.createdAt || new Date().toISOString().split('T')[0],
                createdBy: data.createdBy || 'admin_master_astro',
              });
            });
            callback(lists);
          } else {
            callback([]);
          }
        },
        (error) => {
          handleFirestoreError(error, true);
          if (unsubCol) {
            try { unsubCol(); } catch {}
          }
        }
      );
      return () => {
        if (unsubCol) {
          try { unsubCol(); } catch {}
        }
        if (unsubReg) {
          try { unsubReg(); } catch {}
        }
      };
    } catch (err) {
      handleFirestoreError(err, true);
      return () => {};
    }
  },

  // Fetch lists from Firestore with REST fallback and lists_registry support
  async fetchVaultLists(): Promise<VaultList[] | null> {
    if (isFirestoreReadQuotaExhausted()) return null;
    const listMap = new Map<string, VaultList>();
    const deletedSet = new Set<string>();
    try {
      const rawDel = localStorage.getItem('vault_deleted_list_ids');
      if (rawDel) {
        const parsedDel = JSON.parse(rawDel);
        if (Array.isArray(parsedDel)) parsedDel.forEach((id: string) => deletedSet.add(String(id)));
      }
    } catch {}

    // 1. Check system_config/lists_registry first for deletedIds + consolidated lists
    try {
      const regSnap = await withFirestoreTimeout(getDoc(doc(db, 'system_config', 'lists_registry')), 1500, true);
      if (regSnap.exists()) {
        const regData = regSnap.data() as any;
        if (Array.isArray(regData.deletedIds)) {
          regData.deletedIds.forEach((id: string) => deletedSet.add(String(id)));
          try {
            localStorage.setItem('vault_deleted_list_ids', JSON.stringify(Array.from(deletedSet)));
          } catch {}
        }
        if (regData.listsJson) {
          try {
            const parsed = JSON.parse(regData.listsJson);
            if (Array.isArray(parsed)) {
              parsed.forEach((l: any) => {
                if (l && l.id && !deletedSet.has(l.id)) {
                  listMap.set(l.id, l);
                }
              });
            }
          } catch {}
        }
      }
    } catch {}

    // 1b. REST fallback for lists_registry
    if (listMap.size === 0 && !isFirestoreReadQuotaExhausted()) {
      try {
        const regRes = await fetch(`${FIRESTORE_REST_BASE}/system_config/lists_registry?key=${firebaseConfig.apiKey}`);
        if (regRes.ok) {
          const regJson: any = await regRes.json();
          const fields = regJson?.fields || {};
          if (fields.deletedIds?.arrayValue?.values) {
            fields.deletedIds.arrayValue.values.forEach((v: any) => {
              if (v?.stringValue) deletedSet.add(String(v.stringValue));
            });
            try {
              localStorage.setItem('vault_deleted_list_ids', JSON.stringify(Array.from(deletedSet)));
            } catch {}
          }
          if (fields.listsJson?.stringValue) {
            const parsed = JSON.parse(fields.listsJson.stringValue);
            if (Array.isArray(parsed)) {
              parsed.forEach((l: any) => {
                if (l && l.id && !deletedSet.has(l.id)) {
                  listMap.set(l.id, l);
                }
              });
            }
          }
        }
      } catch {}
    }

    // 2. Check vault_lists collection
    try {
      const colRef = collection(db, 'vault_lists');
      const snap = await withFirestoreTimeout(getDocs(colRef), 1500, true);
      if (!snap.empty) {
        snap.forEach((docSnap) => {
          if (deletedSet.has(docSnap.id)) return;
          const data = docSnap.data();
          listMap.set(docSnap.id, {
            id: docSnap.id,
            name: data.name || 'Lista',
            description: data.description || '',
            icon: data.icon || 'folder',
            color: data.color || '#0066FF',
            itemIds: Array.isArray(data.itemIds) ? data.itemIds : [],
            createdAt: data.createdAt || new Date().toISOString().split('T')[0],
            createdBy: data.createdBy || 'admin_master_astro',
          });
        });
      }
    } catch (e) {
      handleFirestoreError(e, true);
    }

    if (listMap.size > 0) {
      return Array.from(listMap.values());
    }

    if (isFirestoreReadQuotaExhausted()) return null;

    try {
      const url = `${FIRESTORE_REST_BASE}/vault_lists?key=${firebaseConfig.apiKey}&pageSize=100`;
      const res = await fetch(url);
      if (res.status === 429) {
        handleFirestoreError({ code: 'resource-exhausted' }, true);
        return null;
      }
      if (res.ok) {
        const data: any = await res.json();
        if (data && Array.isArray(data.documents) && data.documents.length > 0) {
          const lists: VaultList[] = data.documents
            .map((docSnap: any) => {
              const fields = docSnap.fields || {};
              const id = docSnap.name.split('/').pop() || '';
              let itemIds: string[] = [];
              if (fields.itemIds?.arrayValue?.values) {
                itemIds = fields.itemIds.arrayValue.values.map((v: any) => v.stringValue).filter(Boolean);
              }
              return {
                id,
                name: fields.name?.stringValue || 'Lista',
                description: fields.description?.stringValue || '',
                icon: fields.icon?.stringValue || 'folder',
                color: fields.color?.stringValue || '#0066FF',
                itemIds,
                createdAt: fields.createdAt?.stringValue || new Date().toISOString().split('T')[0],
                createdBy: fields.createdBy?.stringValue || 'admin_master_astro',
              };
            })
            .filter((l: VaultList) => l.id && !deletedSet.has(l.id));
          return lists;
        }
      }
    } catch (restErr) {
      console.warn('Firestore REST lists read error:', restErr);
    }

    return null;
  },

  // Real-time listener for Maintenance Mode in Firestore
  onMaintenanceSnapshot(callback: (maint: { isMaintenance: boolean; message: string; updatedAt?: string }) => void) {
    try {
      const docRef = doc(db, 'system_config', 'maintenance');
      let unsub: (() => void) | null = null;
      unsub = onSnapshot(
        docRef,
        (snapshot) => {
          if (snapshot.exists()) {
            const data = snapshot.data();
            callback({
              isMaintenance: Boolean(data.isMaintenance),
              message: String(data.message || ''),
              updatedAt: data.updatedAt ? String(data.updatedAt) : undefined,
            });
          }
        },
        (err) => {
          // Read operation - do not treat as write quota failure
          handleFirestoreError(err, true);
          if (unsub) {
            try { unsub(); } catch {}
          }
        }
      );
      return () => {
        if (unsub) {
          try { unsub(); } catch {}
        }
      };
    } catch (err) {
      handleFirestoreError(err, true);
      return () => {};
    }
  },

  // Save Maintenance Mode state to Firestore and ensure robust local and cloud persistence
  async saveMaintenance(isMaintenance: boolean, message: string): Promise<boolean> {
    const cleanMessage = String(message || '').trim();
    const updatedAt = new Date().toISOString();

    // 1. Cache locally immediately with timestamp so the app reflects state reliably even offline or across APK restarts
    try {
      localStorage.setItem('vault_maintenance_active', String(isMaintenance));
      if (cleanMessage) localStorage.setItem('vault_maintenance_message', cleanMessage);
      localStorage.setItem('vault_maintenance_updated_at', updatedAt);
    } catch {}

    let savedCloud = false;

    // 2. Attempt cloud persistence via REST PATCH
    try {
      const fields = {
        isMaintenance: { booleanValue: Boolean(isMaintenance) },
        message: { stringValue: cleanMessage },
        updatedAt: { stringValue: updatedAt },
      };
      const res = await firestoreRestFetch('/system_config/maintenance', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields }),
      }, 3000);
      if (res && res.ok) {
        savedCloud = true;
      }
    } catch {}

    // 3. Also attempt cloud persistence via Firestore SDK setDoc (merge)
    try {
      const docRef = doc(db, 'system_config', 'maintenance');
      await withFirestoreTimeout(
        setDoc(docRef, {
          isMaintenance: Boolean(isMaintenance),
          message: cleanMessage,
          updatedAt,
          serverTimestamp: serverTimestamp(),
        }, { merge: true }),
        2500,
        false
      );
      savedCloud = true;
    } catch {}

    return savedCloud;
  },

  // Fetch Maintenance Mode state from Firestore with multiple fallbacks
  async fetchMaintenance(): Promise<{ isMaintenance: boolean; message: string; updatedAt?: string } | null> {
    // 1. Try Firestore REST first (stateless, direct)
    try {
      const res = await firestoreRestFetch('/system_config/maintenance', {}, 3000);
      if (res && res.ok) {
        const data: any = await res.json();
        if (data && data.fields) {
          return {
            isMaintenance: Boolean(data.fields.isMaintenance?.booleanValue),
            message: String(data.fields.message?.stringValue || ''),
            updatedAt: data.fields.updatedAt?.stringValue,
          };
        }
      }
    } catch {}

    // 2. Fallback to Firestore SDK getDoc
    try {
      const docRef = doc(db, 'system_config', 'maintenance');
      const snap = await withFirestoreTimeout(getDoc(docRef), 2500, true);
      if (snap && snap.exists()) {
        const d = snap.data();
        return {
          isMaintenance: Boolean(d.isMaintenance),
          message: String(d.message || ''),
          updatedAt: d.updatedAt ? String(d.updatedAt) : undefined,
        };
      }
    } catch {}

    // 3. Fallback to local storage cache
    try {
      const cached = localStorage.getItem('vault_maintenance_active');
      if (cached !== null) {
        return {
          isMaintenance: cached === 'true',
          message: localStorage.getItem('vault_maintenance_message') || '',
          updatedAt: localStorage.getItem('vault_maintenance_updated_at') || undefined,
        };
      }
    } catch {}

    return null;
  },
};

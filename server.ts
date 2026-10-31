import express from 'express';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import { createServer as createViteServer } from 'vite';
import rawFirebaseConfig from './firebase-applet-config.json';

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// High body limits for API payloads
app.use(express.json({ limit: '2048mb' }));
app.use(express.urlencoded({ extended: true, limit: '2048mb' }));

// Storage directory for persistent server-side vault items and uploads
const DATA_DIR = path.join(process.cwd(), 'server_data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const VAULT_FILE = path.join(DATA_DIR, 'vault_items.json');
const VAULT_LISTS_FILE = path.join(DATA_DIR, 'vault_lists.json');
const DELETED_LISTS_FILE = path.join(DATA_DIR, 'deleted_lists.json');
const DELETED_ITEMS_FILE = path.join(DATA_DIR, 'deleted_items.json');
const MAINTENANCE_FILE = path.join(DATA_DIR, 'maintenance.json');
const LIVE_SYNC_FILE = path.join(DATA_DIR, 'live_sync.json');
const RECEIPTS_FILE = path.join(DATA_DIR, 'receipts.json');
const DELETED_RECEIPTS_FILE = path.join(DATA_DIR, 'deleted_receipts.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const ADMIN_SECURITY_KEY = '360';
const FIRESTORE_DB_ID = (rawFirebaseConfig as any).firestoreDatabaseId || '(default)';
const FIRESTORE_API_KEY = (rawFirebaseConfig as any).apiKey || '';
const FIRESTORE_DOCS_BASE = `https://firestore.googleapis.com/v1/projects/${rawFirebaseConfig.projectId}/databases/${encodeURIComponent(FIRESTORE_DB_ID)}/documents`;

// Allow cross-origin requests from deployed clients (APK / Web / Shared URL)
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Cache-Control, Authorization');
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  next();
});

let serverFirestoreWriteQuotaCooldownUntil = 0;
let serverFirestoreReadQuotaCooldownUntil = 0;

function isServerFirestoreWriteQuotaExhausted(): boolean {
  return Date.now() < serverFirestoreWriteQuotaCooldownUntil;
}
function isServerFirestoreReadQuotaExhausted(): boolean {
  return Date.now() < serverFirestoreReadQuotaCooldownUntil;
}
function isServerFirestoreQuotaExhausted(): boolean {
  return isServerFirestoreWriteQuotaExhausted();
}
function markServerFirestoreQuotaExhausted(isRead = false, errText = ''): void {
  const isWriteErr = errText.toLowerCase().includes('write') || !isRead;
  if (isWriteErr) {
    serverFirestoreWriteQuotaCooldownUntil = Date.now() + 15 * 60 * 1000;
  } else {
    serverFirestoreReadQuotaCooldownUntil = Date.now() + 15 * 60 * 1000;
  }
}

async function serverFirestoreFetch(docPath: string, options: RequestInit = {}, timeoutMs = 2500): Promise<Response | null> {
  const method = String(options.method || 'GET').toUpperCase();
  const isRead = method === 'GET' || method === 'HEAD';
  if (isRead ? isServerFirestoreReadQuotaExhausted() : isServerFirestoreWriteQuotaExhausted()) {
    return null;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const sep = docPath.includes('?') ? '&' : '?';
    const url = `${FIRESTORE_DOCS_BASE}${docPath}${FIRESTORE_API_KEY ? `${sep}key=${encodeURIComponent(FIRESTORE_API_KEY)}` : ''}`;
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (res.status === 429) {
      markServerFirestoreQuotaExhausted(isRead);
      return null;
    }
    if (!res.ok && res.status >= 400) {
      try {
        const clone = res.clone();
        const errText = await clone.text();
        if (errText.includes('RESOURCE_EXHAUSTED') || errText.includes('Quota exceeded')) {
          markServerFirestoreQuotaExhausted(isRead, errText);
          return null;
        }
      } catch {}
    }
    return res;
  } catch {
    clearTimeout(timer);
    return null;
  }
}

// Ensure storage directories exist
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Helper to format bytes
function formatFileBytes(bytes: number): string {
  if (!bytes || bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// Multer disk storage for streaming files directly to disk without memory limits
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    const rawId = req.query?.itemId || req.body?.itemId || `vault-res-${Date.now()}`;
    const safeId = String(rawId).replace(/[^a-zA-Z0-9_-]/g, '');
    let originalName = 'file';
    try {
      originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
    } catch {
      originalName = file.originalname;
    }
    const safeFileName = originalName.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${safeId}_${safeFileName}`);
  },
});

// Configure multer: strictly unlimited file size (sin límite de megas)
const uploadMiddleware = multer({
  storage,
  limits: {
    fileSize: Infinity, // Unlimited file size
    fieldSize: 100 * 1024 * 1024,
  },
});

// Helper to track deleted list IDs across reboots and cache syncs
function readDeletedListIds(): Set<string> {
  try {
    if (fs.existsSync(DELETED_LISTS_FILE)) {
      const raw = fs.readFileSync(DELETED_LISTS_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return new Set(parsed.map(String));
      }
    }
  } catch (err) {
    console.error('Error reading deleted list ids:', err);
  }
  return new Set<string>();
}

function addDeletedListId(id: string): void {
  try {
    const current = readDeletedListIds();
    current.add(id);
    fs.writeFileSync(DELETED_LISTS_FILE, JSON.stringify(Array.from(current), null, 2), 'utf-8');
  } catch (err) {
    console.error('Error recording deleted list id:', err);
  }
}

function removeDeletedListId(id: string): void {
  try {
    const current = readDeletedListIds();
    current.delete(id);
    fs.writeFileSync(DELETED_LISTS_FILE, JSON.stringify(Array.from(current), null, 2), 'utf-8');
  } catch (err) {}
}

// Helper to track deleted item (publicaciones) IDs across reboots and cache syncs
function readDeletedItemIds(): Set<string> {
  try {
    if (fs.existsSync(DELETED_ITEMS_FILE)) {
      const raw = fs.readFileSync(DELETED_ITEMS_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return new Set(parsed.map(String));
      }
    }
  } catch (err) {
    console.error('Error reading deleted item ids:', err);
  }
  return new Set<string>();
}

function addDeletedItemId(id: string): void {
  try {
    const current = readDeletedItemIds();
    current.add(id);
    fs.writeFileSync(DELETED_ITEMS_FILE, JSON.stringify(Array.from(current), null, 2), 'utf-8');
    saveDeletedItemsToFirestoreREST(Array.from(current)).catch(() => {});
  } catch (err) {
    console.error('Error recording deleted item id:', err);
  }
}

function removeDeletedItemId(id: string): void {
  try {
    const current = readDeletedItemIds();
    current.delete(id);
    fs.writeFileSync(DELETED_ITEMS_FILE, JSON.stringify(Array.from(current), null, 2), 'utf-8');
    saveDeletedItemsToFirestoreREST(Array.from(current)).catch(() => {});
  } catch (err) {}
}

async function saveDeletedItemsToFirestoreREST(deletedIds: string[]): Promise<boolean> {
  if (isServerFirestoreQuotaExhausted()) return false;
  try {
    const res = await serverFirestoreFetch('/system_config/items_registry', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fields: {
          deletedIds: {
            arrayValue: {
              values: deletedIds.map((id) => ({ stringValue: String(id) })),
            },
          },
          updatedAt: { stringValue: new Date().toISOString() },
        },
      }),
    });
    return Boolean(res && res.ok);
  } catch {
    return false;
  }
}

async function fetchDeletedItemsFromFirestoreREST(): Promise<string[]> {
  if (isServerFirestoreQuotaExhausted()) return [];
  try {
    const res = await serverFirestoreFetch('/system_config/items_registry');
    if (res && res.ok) {
      const data: any = await res.json();
      const values = data?.fields?.deletedIds?.arrayValue?.values;
      if (Array.isArray(values)) {
        return values.map((v: any) => String(v.stringValue || '')).filter(Boolean);
      }
    }
  } catch {}
  return [];
}

// Maintenance state persistence
interface MaintenanceState {
  isMaintenance: boolean;
  message: string;
  updatedAt: string;
}

function readMaintenanceState(): MaintenanceState {
  try {
    if (fs.existsSync(MAINTENANCE_FILE)) {
      const raw = fs.readFileSync(MAINTENANCE_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        return {
          isMaintenance: typeof parsed.isMaintenance === 'boolean' ? parsed.isMaintenance : false,
          message:
            parsed.message ||
            'El sistema se encuentra en labores de mantenimiento programado. El acceso está temporalmente restringido únicamente a administradores con Key.',
          updatedAt: parsed.updatedAt || new Date().toISOString(),
        };
      }
    }
  } catch (err) {
    console.error('Error reading maintenance file:', err);
  }
  const defaultState: MaintenanceState = {
    isMaintenance: false,
    message:
      'El sistema se encuentra en labores de mantenimiento programado. El acceso está temporalmente restringido únicamente a administradores con Key.',
    updatedAt: new Date().toISOString(),
  };
  try {
    fs.writeFileSync(MAINTENANCE_FILE, JSON.stringify(defaultState, null, 2), 'utf-8');
  } catch (e) {}
  return defaultState;
}

function writeMaintenanceState(state: MaintenanceState): void {
  try {
    fs.writeFileSync(MAINTENANCE_FILE, JSON.stringify(state, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error writing maintenance file:', err);
  }
}

// Sync maintenance state with Firestore REST
async function saveMaintenanceToFirestoreREST(state: MaintenanceState): Promise<boolean> {
  if (isServerFirestoreQuotaExhausted()) return false;
  try {
    const res = await serverFirestoreFetch('/system_config/maintenance', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fields: {
          isMaintenance: { booleanValue: Boolean(state.isMaintenance) },
          message: { stringValue: String(state.message || '') },
          updatedAt: { stringValue: String(state.updatedAt || new Date().toISOString()) },
        },
      }),
    });
    return Boolean(res && res.ok);
  } catch {
    return false;
  }
}

async function fetchMaintenanceFromFirestoreREST(): Promise<MaintenanceState | null> {
  if (isServerFirestoreQuotaExhausted()) return null;
  try {
    const res = await serverFirestoreFetch('/system_config/maintenance');
    if (res && res.ok) {
      const data: any = await res.json();
      const fields = data?.fields;
      if (fields) {
        return {
          isMaintenance: Boolean(fields.isMaintenance?.booleanValue),
          message: String(fields.message?.stringValue || ''),
          updatedAt: String(fields.updatedAt?.stringValue || new Date().toISOString()),
        };
      }
    }
    return null;
  } catch {
    return null;
  }
}


// Initial seed if file does not exist
if (!fs.existsSync(VAULT_FILE)) {
  fs.writeFileSync(VAULT_FILE, JSON.stringify([], null, 2), 'utf-8');
}
if (!fs.existsSync(VAULT_LISTS_FILE)) {
  const defaultLists = [
    {
      id: 'list-apps-systems',
      name: '📱 Archivos iOS & Android',
      description: 'Recursos, utilidades y aplicaciones exclusivas para dispositivos móviles.',
      icon: 'smartphone',
      color: '#0066FF',
      itemIds: ['vault-res-1787518251503'],
      createdAt: '2026-08-23',
      createdBy: 'admin_master_astro',
    },
    {
      id: 'list-regedits-sensi',
      name: '⚡ Regedits y Sensibilidad',
      description: 'Configuraciones de máxima respuesta táctil, archivos REG y paneles optimizados.',
      icon: 'sliders',
      color: '#10B981',
      itemIds: ['vault-res-1787520057677', 'vault-res-1787520090540', 'vault-res-1787520163631'],
      createdAt: '2026-08-23',
      createdBy: 'admin_master_astro',
    },
  ];
  fs.writeFileSync(VAULT_LISTS_FILE, JSON.stringify(defaultLists, null, 2), 'utf-8');
}

// Helper to read lists safely (always filtering out deleted lists)
function readVaultLists(): any[] {
  try {
    const deletedSet = readDeletedListIds();
    if (fs.existsSync(VAULT_LISTS_FILE)) {
      const raw = fs.readFileSync(VAULT_LISTS_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter((l) => l && l.id && l.name && !deletedSet.has(l.id));
      }
    }
  } catch (err) {
    console.error('Error reading vault lists from file:', err);
  }
  return [];
}

// Helper to write lists safely
function writeVaultLists(lists: any[]): boolean {
  try {
    fs.writeFileSync(VAULT_LISTS_FILE, JSON.stringify(lists, null, 2), 'utf-8');
    return true;
  } catch (err) {
    console.error('Error writing vault lists to file:', err);
    return false;
  }
}

// Convert list to Firestore REST format
function listToFirestoreFields(list: any): Record<string, any> {
  const fields: Record<string, any> = {
    id: { stringValue: String(list.id || '') },
    name: { stringValue: String(list.name || '') },
    description: { stringValue: String(list.description || '') },
    icon: { stringValue: String(list.icon || 'folder') },
    color: { stringValue: String(list.color || '#0066FF') },
    createdAt: { stringValue: String(list.createdAt || new Date().toISOString().split('T')[0]) },
    createdBy: { stringValue: String(list.createdBy || 'admin_master_astro') },
    itemIds: {
      arrayValue: {
        values: (Array.isArray(list.itemIds) ? list.itemIds : []).map((id: any) => ({
          stringValue: String(id),
        })),
      },
    },
  };
  return fields;
}

// Save list to Firestore REST
async function saveListToFirestoreREST(list: any): Promise<boolean> {
  if (isServerFirestoreQuotaExhausted() || !list || !list.id) return false;
  try {
    const fields = listToFirestoreFields(list);
    const res = await serverFirestoreFetch(`/vault_lists/${encodeURIComponent(String(list.id))}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields }),
    });
    return Boolean(res && res.ok);
  } catch {
    return false;
  }
}

// Delete list from Firestore REST
async function deleteListFromFirestoreREST(listId: string): Promise<boolean> {
  if (isServerFirestoreQuotaExhausted() || !listId) return false;
  try {
    const res = await serverFirestoreFetch(`/vault_lists/${encodeURIComponent(String(listId))}`, {
      method: 'DELETE',
    });
    return Boolean(res && res.ok);
  } catch {
    return false;
  }
}

// Fetch all lists from Firestore REST
async function fetchAllListsFromFirestoreREST(): Promise<any[]> {
  if (isServerFirestoreQuotaExhausted()) return [];
  try {
    const res = await serverFirestoreFetch('/vault_lists?pageSize=100');
    if (!res || !res.ok) return [];
    const data: any = await res.json();
    if (!data || !Array.isArray(data.documents)) return [];
    return data.documents.map((docSnap: any) => {
      const fields = docSnap.fields || {};
      const id = fields.id?.stringValue || (docSnap.name ? docSnap.name.split('/').pop() : '');
      const itemIds = fields.itemIds?.arrayValue?.values
        ? fields.itemIds.arrayValue.values.map((v: any) => String(v.stringValue || '')).filter(Boolean)
        : [];
      return {
        id,
        name: fields.name?.stringValue || 'Lista sin nombre',
        description: fields.description?.stringValue || '',
        icon: fields.icon?.stringValue || 'folder',
        color: fields.color?.stringValue || '#0066FF',
        itemIds,
        createdAt: fields.createdAt?.stringValue || new Date().toISOString().split('T')[0],
        createdBy: fields.createdBy?.stringValue || 'admin_master_astro',
      };
    });
  } catch {
    return [];
  }
}

// Helper to read items safely
function readVaultItems(): any[] {
  try {
    const deletedSet = readDeletedItemIds();
    if (fs.existsSync(VAULT_FILE)) {
      const raw = fs.readFileSync(VAULT_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter(
          (it) =>
            it &&
            it.id &&
            !deletedSet.has(it.id) &&
            !it.id.startsWith('test-') &&
            !it.id.startsWith('res_00') &&
            it.id !== 'vault-res-test-rest' &&
            it.id !== 'vault-res-direct-1787703256063'
        );
      }
    }
  } catch (err) {
    console.error('Error reading vault items from file:', err);
  }
  return [];
}

// Helper to write items safely
function writeVaultItems(items: any[]): boolean {
  try {
    fs.writeFileSync(VAULT_FILE, JSON.stringify(items, null, 2), 'utf-8');
    return true;
  } catch (err) {
    console.error('Error writing vault items to file:', err);
    return false;
  }
}

// Helper to convert item into Firestore REST fields format
function itemToFirestoreFields(item: any): Record<string, any> {
  const fields: Record<string, any> = {};
  
  // Safe fields only - exclude raw huge binary blobs from Firestore doc to avoid 1MB limit
  const sanitized = {
    id: String(item.id || ''),
    title: String(item.title || ''),
    description: String(item.description || ''),
    category: String(item.category || 'code'),
    fileType: String(item.fileType || ''),
    fileSize: String(item.fileSize || ''),
    fileName: String(item.fileName || ''),
    fileMimeType: String(item.fileMimeType || ''),
    downloadUrl: String(item.downloadUrl || ''),
    coverImage: String(item.coverImage || 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=600&auto=format&fit=crop&q=80'),
    createdAt: String(item.createdAt || new Date().toISOString().split('T')[0]),
    likesCount: Number(item.likesCount ?? 0),
    likedBy: Array.isArray(item.likedBy) ? item.likedBy : [],
    comments: Array.isArray(item.comments) ? item.comments : [],
    isLockedForTier: Boolean(item.isLockedForTier),
    version: String(item.version || 'v1.0'),
    author: item.author || { name: 'Administrador (astroarg02)', badge: 'ADMIN ROOT' },
  };

  for (const [key, value] of Object.entries(sanitized)) {
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
}

// Synchronize an item to Firebase Firestore REST
async function saveToFirestoreREST(item: any): Promise<boolean> {
  if (isServerFirestoreQuotaExhausted() || !item || !item.id) return false;
  try {
    const fields = itemToFirestoreFields(item);
    if (Array.isArray(item.listIds)) {
      fields.listIds = {
        arrayValue: {
          values: item.listIds.map((id: any) => ({ stringValue: String(id) })),
        },
      };
    }
    const res = await serverFirestoreFetch(`/vault_items/${encodeURIComponent(String(item.id))}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields }),
    });
    return Boolean(res && res.ok);
  } catch {
    return false;
  }
}

// Delete item from Firebase Firestore REST
async function deleteFromFirestoreREST(itemId: string): Promise<boolean> {
  if (isServerFirestoreQuotaExhausted() || !itemId) return false;
  try {
    const res = await serverFirestoreFetch(`/vault_items/${encodeURIComponent(String(itemId))}`, {
      method: 'DELETE',
    });
    return Boolean(res && res.ok);
  } catch {
    return false;
  }
}

// Fetch all items from Firestore REST
async function fetchAllFromFirestoreREST(): Promise<any[]> {
  if (isServerFirestoreQuotaExhausted()) return [];
  try {
    const res = await serverFirestoreFetch('/vault_items?pageSize=300');
    if (!res || !res.ok) return [];
    const data: any = await res.json();
    if (!data || !Array.isArray(data.documents)) return [];
    return data.documents
      .map((docSnap: any) => {
        const fields = docSnap.fields || {};
        const id = fields.id?.stringValue || (docSnap.name ? docSnap.name.split('/').pop() : '');
        let author = { name: 'Seis6 Mod', badge: 'ADMIN ROOT' };
        if (fields.author?.stringValue) {
          try {
            author = JSON.parse(fields.author.stringValue);
          } catch {
            author = { name: fields.author.stringValue, badge: 'ADMIN ROOT' };
          }
        }
        const likedBy = fields.likedBy?.arrayValue?.values
          ? fields.likedBy.arrayValue.values.map((v: any) => v.stringValue).filter(Boolean)
          : [];
        const comments = fields.comments?.arrayValue?.values
          ? fields.comments.arrayValue.values.map((v: any) => {
              try {
                return JSON.parse(v.stringValue);
              } catch {
                return v.stringValue;
              }
            })
          : [];
        const listIds = fields.listIds?.arrayValue?.values
          ? fields.listIds.arrayValue.values.map((v: any) => v.stringValue).filter(Boolean)
          : [];
        return {
          id,
          title: fields.title?.stringValue || 'Sin título',
          description: fields.description?.stringValue || '',
          category: fields.category?.stringValue || 'code',
          fileType: fields.fileType?.stringValue || '',
          fileSize: fields.fileSize?.stringValue || '',
          fileName: fields.fileName?.stringValue || undefined,
          fileMimeType: fields.fileMimeType?.stringValue || undefined,
          downloadUrl: fields.downloadUrl?.stringValue || '',
          coverImage: fields.coverImage?.stringValue || '',
          createdAt: fields.createdAt?.stringValue || new Date().toISOString().split('T')[0],
          likesCount: Number(fields.likesCount?.integerValue || fields.likesCount?.doubleValue || 0),
          likedBy,
          comments,
          listIds,
          isLockedForTier: Boolean(fields.isLockedForTier?.booleanValue),
          version: fields.version?.stringValue || 'v1.0',
          author,
        };
      })
      .filter((it: any) => {
        const id = it.id;
        const deletedSet = readDeletedItemIds();
        return (
          id &&
          !deletedSet.has(id) &&
          !id.startsWith('res_00') &&
          !id.startsWith('test-') &&
          id !== 'vault-res-test-rest' &&
          id !== 'vault-res-direct-1787703256063'
        );
      });
  } catch {
    return [];
  }
}

// API Routes
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.get('/api/android/vite-source', (_req, res) => {
  try {
    const readSafe = (p: string) => fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : '';
    res.json({
      success: true,
      capacitorConfig: readSafe(path.join(process.cwd(), 'capacitor.config.json')),
      packageJson: readSafe(path.join(process.cwd(), 'package.json')),
      packageLock: readSafe(path.join(process.cwd(), 'package-lock.json')),
      workflowYml: readSafe(path.join(process.cwd(), '.github', 'workflows', 'build-android.yml')),
      configureScript: readSafe(path.join(process.cwd(), 'scripts', 'configure-android.cjs')),
      viteConfig: readSafe(path.join(process.cwd(), 'vite.config.ts')),
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/flutter/source', (_req, res) => {
  try {
    const pubspecPath = path.join(process.cwd(), 'flutter_app', 'pubspec.yaml');
    const mainDartPath = path.join(process.cwd(), 'flutter_app', 'lib', 'main.dart');
    const workflowPath = path.join(process.cwd(), '.github', 'workflows', 'build-android.yml');

    const readSafe = (p: string) => fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : '';

    const androidFiles: Record<string, string> = {
      'android/settings.gradle': readSafe(path.join(process.cwd(), 'flutter_app', 'android', 'settings.gradle')),
      'android/build.gradle': readSafe(path.join(process.cwd(), 'flutter_app', 'android', 'build.gradle')),
      'android/app/build.gradle': readSafe(path.join(process.cwd(), 'flutter_app', 'android', 'app', 'build.gradle')),
      'android/app/src/main/AndroidManifest.xml': readSafe(path.join(process.cwd(), 'flutter_app', 'android', 'app', 'src', 'main', 'AndroidManifest.xml')),
      'android/app/src/main/kotlin/com/seis6/seis6_vault_native/MainActivity.kt': readSafe(path.join(process.cwd(), 'flutter_app', 'android', 'app', 'src', 'main', 'kotlin', 'com', 'seis6', 'seis6_vault_native', 'MainActivity.kt')),
      'android/app/src/main/res/values/styles.xml': readSafe(path.join(process.cwd(), 'flutter_app', 'android', 'app', 'src', 'main', 'res', 'values', 'styles.xml')),
      'android/app/src/main/res/values-night/styles.xml': readSafe(path.join(process.cwd(), 'flutter_app', 'android', 'app', 'src', 'main', 'res', 'values-night', 'styles.xml')),
      'android/gradle/wrapper/gradle-wrapper.properties': readSafe(path.join(process.cwd(), 'flutter_app', 'android', 'gradle', 'wrapper', 'gradle-wrapper.properties')),
    };

    res.json({
      success: true,
      pubspec: readSafe(pubspecPath),
      mainDart: readSafe(mainDartPath),
      workflowYml: readSafe(workflowPath),
      androidFiles,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/maintenance & /api/maintenance/status - Fetch current maintenance mode status
const handleGetMaintenance = async (req: express.Request, res: express.Response) => {
  let state = readMaintenanceState();
  try {
    const cloudState = await fetchMaintenanceFromFirestoreREST();
    if (cloudState && cloudState.updatedAt) {
      const localTime = new Date(state.updatedAt).getTime() || 0;
      const cloudTime = new Date(cloudState.updatedAt).getTime() || 0;
      // Only adopt Firestore state if it is genuinely newer than server state
      if (cloudTime > localTime) {
        state = cloudState;
        writeMaintenanceState(cloudState);
      }
    }
  } catch {}
  res.json({ success: true, ...state });
};

app.get('/api/maintenance', handleGetMaintenance);
app.get('/api/maintenance/status', handleGetMaintenance);

// POST /api/maintenance & /api/maintenance/status - Update maintenance mode (Admin with key or admin session)
const handlePostMaintenance = async (req: express.Request, res: express.Response) => {
  try {
    const { isMaintenance, message, adminKey } = req.body;
    // Allow if adminKey matches 360 or ADMIN_SECURITY_KEY
    if (adminKey && adminKey.trim() !== ADMIN_SECURITY_KEY && adminKey.trim() !== '360') {
      return res.status(403).json({ success: false, error: 'Key de seguridad no autorizada' });
    }
    const current = readMaintenanceState();
    const updated: MaintenanceState = {
      isMaintenance: typeof isMaintenance === 'boolean' ? isMaintenance : current.isMaintenance,
      message: typeof message === 'string' && message.trim() ? message.trim() : current.message,
      updatedAt: typeof req.body.updatedAt === 'string' && req.body.updatedAt.trim() ? req.body.updatedAt.trim() : new Date().toISOString(),
    };
    writeMaintenanceState(updated);
    
    // Sync to Firestore REST in background/async so Cloud Firestore is always synchronized if quota permits
    try {
      saveMaintenanceToFirestoreREST(updated).catch(() => {});
    } catch (fsErr) {
      console.warn('[Firestore Maintenance Save Warning]:', fsErr);
    }

    console.log(`[Maintenance Mode Updated] isMaintenance: ${updated.isMaintenance}, message: ${updated.message}`);
    return res.json({ success: true, ...updated });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

app.post('/api/maintenance', handlePostMaintenance);
app.post('/api/maintenance/status', handlePostMaintenance);

// Live Sync OTA State helpers & endpoints
interface LiveSyncState {
  enabled: boolean;
  liveServerUrl: string;
  version: string;
  forceRefreshId: string;
  buildTimestamp: string;
  notes: string;
  updatedAt: string;
}

const DEFAULT_LIVE_SYNC_STATE: LiveSyncState = {
  enabled: true,
  liveServerUrl: 'https://astroarg02-cloud.github.io/seis6-app/',
  version: '1.0.2',
  forceRefreshId: 'boot-sync-1',
  buildTimestamp: new Date().toISOString(),
  notes: 'Actualizaciones en vivo OTA activas',
  updatedAt: new Date().toISOString(),
};

function readLiveSyncState(): LiveSyncState {
  try {
    if (fs.existsSync(LIVE_SYNC_FILE)) {
      const raw = fs.readFileSync(LIVE_SYNC_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      return { ...DEFAULT_LIVE_SYNC_STATE, ...parsed };
    }
  } catch (e) {}
  return DEFAULT_LIVE_SYNC_STATE;
}

function writeLiveSyncState(state: LiveSyncState) {
  try {
    fs.writeFileSync(LIVE_SYNC_FILE, JSON.stringify(state, null, 2), 'utf-8');
  } catch (e) {
    console.error('Error writing live_sync.json:', e);
  }
}

app.get('/api/live-sync', (req, res) => {
  const state = readLiveSyncState();
  return res.json({ success: true, ...state });
});

app.post('/api/live-sync', (req, res) => {
  try {
    const current = readLiveSyncState();
    const updated: LiveSyncState = {
      ...current,
      ...req.body,
      updatedAt: new Date().toISOString(),
    };
    writeLiveSyncState(updated);
    return res.json({ success: true, ...updated });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/vault/deleted-items - Return item IDs deleted by admin so all clients purge them immediately
app.get('/api/vault/deleted-items', (_req, res) => {
  const deletedSet = readDeletedItemIds();
  return res.json({ success: true, deletedIds: Array.from(deletedSet) });
});

// GET /api/vault/items - Fetch all items from Firestore + Server Store
app.get('/api/vault/items', async (req, res) => {
  try {
    const deletedSet = readDeletedItemIds();
    const localItems = readVaultItems();
    const firestoreItems = await fetchAllFromFirestoreREST();

    // Merge without duplicates and filter out any deleted items
    const itemMap = new Map<string, any>();
    localItems.forEach((i) => {
      if (i && i.id && !deletedSet.has(i.id)) itemMap.set(i.id, i);
    });
    firestoreItems.forEach((i) => {
      if (i && i.id && !deletedSet.has(i.id)) {
        const existing = itemMap.get(i.id);
        itemMap.set(i.id, { ...existing, ...i });
      }
    });

    const merged = Array.from(itemMap.values()).filter((i) => !deletedSet.has(i.id));
    if (merged.length > 0) {
      writeVaultItems(merged);
    }
    return res.json({ success: true, items: merged });
  } catch (err: any) {
    const localItems = readVaultItems();
    return res.json({ success: true, items: localItems });
  }
});

// POST /api/vault/upload-file - Dedicated endpoint for streaming files of ANY size directly to disk (NO MB LIMIT)
app.post('/api/vault/upload-file', uploadMiddleware.single('file') as any, async (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ success: false, error: 'No se recibió ningún archivo' });
    }

    const rawId = req.body?.itemId || req.query?.itemId || `vault-res-${Date.now()}`;
    const itemId = String(rawId).replace(/[^a-zA-Z0-9_-]/g, '');

    let originalName = 'archivo';
    try {
      originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
    } catch {
      originalName = file.originalname;
    }

    const formattedSize = formatFileBytes(file.size);
    const downloadUrl = `/api/vault/download/${encodeURIComponent(itemId)}`;

    console.log(`[VAULT Storage] File saved to disk: "${originalName}" (${formattedSize}) for item ${itemId}`);

    // If item already exists in server vault, update its file metadata
    const currentItems = readVaultItems();
    const existingIndex = currentItems.findIndex((i) => i.id === itemId);
    if (existingIndex >= 0) {
      currentItems[existingIndex] = {
        ...currentItems[existingIndex],
        fileName: originalName,
        fileSize: formattedSize,
        fileMimeType: file.mimetype || 'application/octet-stream',
        downloadUrl,
      };
      writeVaultItems(currentItems);
      await saveToFirestoreREST(currentItems[existingIndex]);
    }

    return res.json({
      success: true,
      itemId,
      fileName: originalName,
      fileSize: formattedSize,
      fileMimeType: file.mimetype,
      downloadUrl,
      bytes: file.size,
    });
  } catch (err: any) {
    console.error('Error uploading file to server disk:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/vault/check-file/:id - Check if a physical file exists on disk for this item
app.get('/api/vault/check-file/:id', (req, res) => {
  const { id } = req.params;
  if (!id) return res.json({ exists: false });

  if (fs.existsSync(UPLOADS_DIR)) {
    const files = fs.readdirSync(UPLOADS_DIR);
    const matchedFile = files.find((f) => f.startsWith(`${id}_`));
    if (matchedFile) {
      const filePath = path.join(UPLOADS_DIR, matchedFile);
      const stat = fs.statSync(filePath);
      return res.json({
        exists: true,
        fileName: matchedFile.replace(`${id}_`, ''),
        fileSize: stat.size,
        formattedSize: formatFileBytes(stat.size),
      });
    }
  }

  const items = readVaultItems();
  const item = items.find((i) => i.id === id);
  if (item && item.fileData) {
    return res.json({ exists: true, fileName: item.fileName, isBase64: true });
  }

  return res.json({ exists: false });
});

// POST /api/vault/upload - Add or update a vault item (Guaranteed Firebase Firestore + Server storage)
app.post('/api/vault/upload', async (req, res) => {
  try {
    const newItem = req.body;
    if (!newItem || !newItem.title) {
      return res.status(400).json({ success: false, error: 'Título requerido' });
    }

    if (!newItem.id) {
      newItem.id = `vault-res-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    }

    // Unmark as deleted if re-created/uploaded
    removeDeletedItemId(newItem.id);

    // Check if a physical file already exists in UPLOADS_DIR for this item
    if (fs.existsSync(UPLOADS_DIR)) {
      const files = fs.readdirSync(UPLOADS_DIR);
      const matchedFile = files.find((f) => f.startsWith(`${newItem.id}_`));
      if (matchedFile) {
        newItem.downloadUrl = `/api/vault/download/${encodeURIComponent(newItem.id)}`;
        if (!newItem.fileName) {
          newItem.fileName = matchedFile.replace(`${newItem.id}_`, '');
        }
      }
    }

    // If file data is provided as base64, save to uploads directory
    if (newItem.fileData && typeof newItem.fileData === 'string' && newItem.fileData.startsWith('data:')) {
      try {
        const matches = newItem.fileData.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
        if (matches && matches.length === 3) {
          const buffer = Buffer.from(matches[2], 'base64');
          const safeFilename = `${newItem.id}_${(newItem.fileName || 'file').replace(/[^a-zA-Z0-9.-]/g, '_')}`;
          const filePath = path.join(UPLOADS_DIR, safeFilename);
          fs.writeFileSync(filePath, buffer);
          // Set server download endpoint
          newItem.downloadUrl = `/api/vault/download/${encodeURIComponent(newItem.id)}`;
        }
      } catch (fileErr) {
        console.warn('Could not save raw file to server uploads disk:', fileErr);
      }
    }

    // If mediafireUrl or external downloadUrl is provided, keep it as the primary downloadUrl
    if (newItem.mediafireUrl) {
      newItem.downloadUrl = newItem.mediafireUrl;
    } else if (newItem.downloadUrl && newItem.downloadUrl.includes('mediafire.com')) {
      newItem.mediafireUrl = newItem.downloadUrl;
    } else if (!newItem.downloadUrl && (newItem.fileName || newItem.fileType)) {
      newItem.downloadUrl = `/api/vault/download/${encodeURIComponent(newItem.id)}`;
    }

    // Save locally
    const currentItems = readVaultItems();
    const existingIndex = currentItems.findIndex((i) => i.id === newItem.id);
    let updatedItems: any[];

    if (existingIndex >= 0) {
      updatedItems = [...currentItems];
      updatedItems[existingIndex] = { ...updatedItems[existingIndex], ...newItem };
    } else {
      updatedItems = [newItem, ...currentItems];
    }

    writeVaultItems(updatedItems);
    console.log(`[VAULT Server] New item saved: "${newItem.title}" (${newItem.id})`);

    // Persist to Firestore REST
    const firestoreOk = await saveToFirestoreREST(newItem);

    return res.json({
      success: true,
      item: newItem,
      firestoreSynced: firestoreOk,
      total: updatedItems.length,
    });
  } catch (err: any) {
    console.error('Error uploading item:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// HEAD and GET /api/vault/download/:id - Direct download of stored file with UTF-8 support
const handleFileDownload = (req: express.Request, res: express.Response) => {
  const { id } = req.params;
  const items = readVaultItems();
  let item = items.find((i) => i.id === id);
  if (!item) {
    item = items.find((i) => i.downloadUrl && (i.downloadUrl.includes(`/${id}`) || i.downloadUrl.includes(encodeURIComponent(id))));
  }

  // 0. Priority redirect to MediaFire or external link
  if (item && (item.mediafireUrl || (item.downloadUrl && item.downloadUrl.startsWith('http')))) {
    const target = item.mediafireUrl || item.downloadUrl;
    return res.redirect(target);
  }

  // 1. Check in uploads dir
  if (fs.existsSync(UPLOADS_DIR)) {
    const files = fs.readdirSync(UPLOADS_DIR);
    let matchedFile = files.find((f) => f.startsWith(`${id}_`));

    // Also check if item.downloadUrl points to a different uploaded id
    if (!matchedFile && item?.downloadUrl && item.downloadUrl.includes('/api/vault/download/')) {
      const parts = item.downloadUrl.split('/api/vault/download/');
      const altId = decodeURIComponent(parts[1] || '').replace(/[^a-zA-Z0-9_-]/g, '');
      if (altId) {
        matchedFile = files.find((f) => f.startsWith(`${altId}_`));
      }
    }

    // Also check if any file in UPLOADS_DIR matches item.fileName
    if (!matchedFile && item?.fileName) {
      const cleanTarget = item.fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
      matchedFile = files.find((f) => {
        return f.endsWith(`_${item.fileName}`) || f.endsWith(`_${cleanTarget}`) || f === item.fileName || f === cleanTarget;
      });
    }

    if (matchedFile) {
      const filePath = path.join(UPLOADS_DIR, matchedFile);
      const downloadName = item?.fileName || matchedFile.replace(/^[a-zA-Z0-9_-]+_/, '');
      
      if (req.method === 'HEAD') {
        const stat = fs.statSync(filePath);
        res.setHeader('Content-Length', stat.size);
        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(downloadName)}`);
        return res.status(200).end();
      }

      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(downloadName)}`);
      return res.download(filePath, downloadName);
    }
  }

  // 2. Check if item has stored fileData (data URL or base64)
  if (item && item.fileData && typeof item.fileData === 'string' && item.fileData.startsWith('data:')) {
    try {
      const matches = item.fileData.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
      if (matches && matches.length === 3) {
        const mime = matches[1];
        const buffer = Buffer.from(matches[2], 'base64');
        const filename = item.fileName || `${item.title || 'recurso'}.${mime.split('/')[1] || 'bin'}`;
        
        // Save to disk for faster future access
        const safeFilename = `${id}_${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
        fs.writeFileSync(path.join(UPLOADS_DIR, safeFilename), buffer);

        if (req.method === 'HEAD') {
          res.setHeader('Content-Length', buffer.length);
          res.setHeader('Content-Type', mime);
          return res.status(200).end();
        }

        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
        res.setHeader('Content-Type', mime);
        return res.send(buffer);
      }
    } catch (e) {
      console.warn('Error reading base64 fileData on download:', e);
    }
  }

  // 3. Fallback to external downloadUrl
  if (item && item.downloadUrl && item.downloadUrl.startsWith('http')) {
    return res.redirect(item.downloadUrl);
  }

  if (req.method === 'HEAD') {
    return res.status(404).end();
  }
  return res.status(404).send('Archivo no encontrado en el servidor');
};

app.head('/api/vault/download/:id', handleFileDownload);
app.get('/api/vault/download/:id', handleFileDownload);

// POST /api/vault/sync - Batch sync items from admin client
app.post('/api/vault/sync', async (req, res) => {
  try {
    const { items } = req.body;
    if (!Array.isArray(items)) {
      return res.status(400).json({ success: false, error: 'Array de items requerido' });
    }

    const deletedSet = readDeletedItemIds();
    const currentItems = readVaultItems();
    const map = new Map<string, any>();

    currentItems.forEach((it) => {
      if (it && it.id && !deletedSet.has(it.id)) map.set(it.id, it);
    });

    items.forEach((it) => {
      if (it && it.id && !deletedSet.has(it.id)) {
        map.set(it.id, { ...(map.get(it.id) || {}), ...it });
      }
    });

    const merged = Array.from(map.values()).filter((it) => !deletedSet.has(it.id));
    writeVaultItems(merged);

    // Background sync to Firestore REST (only non-deleted items)
    (async () => {
      for (const it of merged) {
        if (!deletedSet.has(it.id)) {
          await saveToFirestoreREST(it);
        }
      }
    })().catch(() => {});

    return res.json({ success: true, items: merged });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/vault/items/:id/like - Toggle like
app.post('/api/vault/items/:id/like', async (req, res) => {
  try {
    const { id } = req.params;
    const { likesCount, likedBy } = req.body;
    const items = readVaultItems();
    const index = items.findIndex((i) => i.id === id);

    if (index >= 0) {
      items[index].likesCount = typeof likesCount === 'number' ? likesCount : items[index].likesCount;
      if (Array.isArray(likedBy)) {
        items[index].likedBy = likedBy;
      }
      writeVaultItems(items);
      saveToFirestoreREST(items[index]).catch(() => {});
      return res.json({ success: true, item: items[index] });
    }
    return res.status(404).json({ success: false, error: 'Item no encontrado' });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/vault/items/:id/comment - Add comment
app.post('/api/vault/items/:id/comment', async (req, res) => {
  try {
    const { id } = req.params;
    const { comments } = req.body;
    const items = readVaultItems();
    const index = items.findIndex((i) => i.id === id);

    if (index >= 0) {
      if (Array.isArray(comments)) {
        items[index].comments = comments;
      }
      writeVaultItems(items);
      saveToFirestoreREST(items[index]).catch(() => {});
      return res.json({ success: true, item: items[index] });
    }
    return res.status(404).json({ success: false, error: 'Item no encontrado' });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/vault/items/:id - Delete item (Admin)
app.delete('/api/vault/items/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ success: false, error: 'ID requerido' });
    }
    // Record persistently as deleted so no background sync or Firestore fetch can resurrect it
    addDeletedItemId(id);

    const items = readVaultItems();
    const updated = items.filter((i) => i.id !== id);
    writeVaultItems(updated);
    await deleteFromFirestoreREST(id);

    // Also remove from disk in UPLOADS_DIR if a physical file was stored
    if (fs.existsSync(UPLOADS_DIR)) {
      try {
        const files = fs.readdirSync(UPLOADS_DIR);
        for (const f of files) {
          if (f.startsWith(`${id}_`)) {
            try {
              fs.unlinkSync(path.join(UPLOADS_DIR, f));
              console.log(`[VAULT Server] Deleted physical file: ${f}`);
            } catch {}
          }
        }
      } catch {}
    }

    // Also remove from all lists
    const lists = readVaultLists();
    let listsChanged = false;
    const updatedLists = lists.map((l) => {
      if (l.itemIds && l.itemIds.includes(id)) {
        listsChanged = true;
        return { ...l, itemIds: l.itemIds.filter((itemId: string) => itemId !== id) };
      }
      return l;
    });
    if (listsChanged) {
      writeVaultLists(updatedLists);
      for (const l of updatedLists) {
        saveListToFirestoreREST(l).catch(() => {});
      }
    }

    return res.json({ success: true, total: updated.length, deletedId: id });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/vault/deleted-lists - Return list IDs deleted by admin so all clients purge them immediately
app.get('/api/vault/deleted-lists', (_req, res) => {
  const deletedSet = readDeletedListIds();
  return res.json({ success: true, deletedIds: Array.from(deletedSet) });
});

// GET /api/vault/lists - Fetch all lists created by Admin
app.get('/api/vault/lists', async (req, res) => {
  try {
    const deletedSet = readDeletedListIds();
    const localLists = readVaultLists();
    const firestoreLists = await fetchAllListsFromFirestoreREST();

    const listMap = new Map<string, any>();
    localLists.forEach((l) => {
      if (l && l.id && !deletedSet.has(l.id)) listMap.set(l.id, l);
    });
    firestoreLists.forEach((l) => {
      if (l && l.id && !deletedSet.has(l.id)) {
        const existing = listMap.get(l.id);
        listMap.set(l.id, { ...existing, ...l });
      }
    });

    const merged = Array.from(listMap.values()).filter((l) => !deletedSet.has(l.id));
    writeVaultLists(merged);
    return res.json({ success: true, lists: merged });
  } catch (err: any) {
    const deletedSet = readDeletedListIds();
    const localLists = readVaultLists().filter((l) => !deletedSet.has(l.id));
    return res.json({ success: true, lists: localLists });
  }
});

// POST /api/vault/lists - Create or update list (Admin)
app.post('/api/vault/lists', async (req, res) => {
  try {
    const newList = req.body;
    if (!newList || !newList.name) {
      return res.status(400).json({ success: false, error: 'Nombre de lista requerido' });
    }

    if (!newList.id) {
      newList.id = `list-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    }
    if (!Array.isArray(newList.itemIds)) {
      newList.itemIds = [];
    }
    if (!newList.createdAt) {
      newList.createdAt = new Date().toISOString().split('T')[0];
    }

    // Unmark as deleted if recreated
    removeDeletedListId(newList.id);

    const currentLists = readVaultLists();
    const existingIndex = currentLists.findIndex((l) => l.id === newList.id);
    let updatedLists: any[];

    if (existingIndex >= 0) {
      updatedLists = [...currentLists];
      updatedLists[existingIndex] = { ...updatedLists[existingIndex], ...newList };
    } else {
      updatedLists = [newList, ...currentLists];
    }

    writeVaultLists(updatedLists);
    await saveListToFirestoreREST(newList);

    return res.json({
      success: true,
      list: newList,
      lists: updatedLists,
    });
  } catch (err: any) {
    console.error('Error saving list:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/vault/lists/:id - Delete list (Admin)
app.delete('/api/vault/lists/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ success: false, error: 'ID requerido' });
    }

    // 1. Mark as permanently deleted in deleted lists tracker
    addDeletedListId(id);

    // 2. Remove from local JSON storage
    const lists = readVaultLists();
    const updated = lists.filter((l) => l.id !== id);
    writeVaultLists(updated);

    // 3. Remove from Firestore REST
    await deleteListFromFirestoreREST(id);

    return res.json({ success: true, lists: updated, deletedId: id });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/vault/lists/:id/toggle-item - Add or remove publication from list (Admin)
app.post('/api/vault/lists/:id/toggle-item', async (req, res) => {
  try {
    const { id } = req.params;
    const { itemId } = req.body;
    if (!itemId) {
      return res.status(400).json({ success: false, error: 'ID de publicación requerido' });
    }

    const lists = readVaultLists();
    const listIndex = lists.findIndex((l) => l.id === id);
    if (listIndex < 0) {
      return res.status(404).json({ success: false, error: 'Lista no encontrada' });
    }

    const targetList = lists[listIndex];
    const currentItemIds: string[] = Array.isArray(targetList.itemIds) ? targetList.itemIds : [];
    const isInside = currentItemIds.includes(itemId);

    const newItemIds = isInside
      ? currentItemIds.filter((itId) => itId !== itemId)
      : [...currentItemIds, itemId];

    targetList.itemIds = newItemIds;
    lists[listIndex] = targetList;
    writeVaultLists(lists);
    await saveListToFirestoreREST(targetList);

    return res.json({ success: true, list: targetList, isInside: !isInside });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// --- PAYMENT RECEIPTS PERSISTENCE (Server File + Disk Image + Firestore REST) ---

if (!fs.existsSync(RECEIPTS_FILE)) {
  fs.writeFileSync(RECEIPTS_FILE, JSON.stringify([], null, 2), 'utf-8');
}

function readDeletedReceiptIds(): Set<string> {
  try {
    if (fs.existsSync(DELETED_RECEIPTS_FILE)) {
      const raw = fs.readFileSync(DELETED_RECEIPTS_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return new Set(parsed.map(String));
      }
    }
  } catch (err) {
    console.error('Error reading deleted receipt ids:', err);
  }
  return new Set<string>();
}

function addDeletedReceiptId(id: string): void {
  try {
    const current = readDeletedReceiptIds();
    current.add(id);
    fs.writeFileSync(DELETED_RECEIPTS_FILE, JSON.stringify(Array.from(current), null, 2), 'utf-8');
  } catch (err) {
    console.error('Error recording deleted receipt id:', err);
  }
}

function removeDeletedReceiptId(id: string): void {
  try {
    const current = readDeletedReceiptIds();
    if (current.has(id)) {
      current.delete(id);
      fs.writeFileSync(DELETED_RECEIPTS_FILE, JSON.stringify(Array.from(current), null, 2), 'utf-8');
    }
  } catch (err) {
    console.error('Error removing deleted receipt id:', err);
  }
}

// Helper to read payment receipts safely
function readReceipts(): any[] {
  try {
    const deletedSet = readDeletedReceiptIds();
    if (fs.existsSync(RECEIPTS_FILE)) {
      const raw = fs.readFileSync(RECEIPTS_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter(
          (r) => r && r.id && !deletedSet.has(r.id) && !String(r.id).startsWith('rec-demo')
        );
      }
    }
  } catch (err) {
    console.error('Error reading receipts from file:', err);
  }
  return [];
}

// Helper to write payment receipts safely
function writeReceipts(receipts: any[]): boolean {
  try {
    const deletedSet = readDeletedReceiptIds();
    const clean = (Array.isArray(receipts) ? receipts : []).filter(
      (r) => r && r.id && !deletedSet.has(r.id) && !String(r.id).startsWith('rec-demo')
    );
    fs.writeFileSync(RECEIPTS_FILE, JSON.stringify(clean, null, 2), 'utf-8');
    return true;
  } catch (err) {
    console.error('Error writing receipts to file:', err);
    return false;
  }
}

// Save receipt image to disk if it's a base64 data URL so it can always be served even if large
function saveReceiptImageToDisk(receipt: any): void {
  try {
    if (!receipt || !receipt.id || !receipt.receiptImageUrl) return;
    const imgStr = String(receipt.receiptImageUrl);
    if (!imgStr.startsWith('data:image/')) return;
    const matches = imgStr.match(/^data:(image\/[A-Za-z0-9.+-]+);base64,(.+)$/);
    if (matches && matches.length === 3) {
      const buffer = Buffer.from(matches[2], 'base64');
      const safeId = String(receipt.id).replace(/[^a-zA-Z0-9_-]/g, '');
      const filePath = path.join(UPLOADS_DIR, `receipt_${safeId}.bin`);
      const metaPath = path.join(UPLOADS_DIR, `receipt_${safeId}.meta.json`);
      fs.writeFileSync(filePath, buffer);
      fs.writeFileSync(metaPath, JSON.stringify({ mimeType: matches[1], dataUrl: imgStr }), 'utf-8');
    }
  } catch (err) {
    console.warn('Could not save receipt image backup to disk:', err);
  }
}

function loadReceiptImageFromDisk(receiptId: string): string | null {
  try {
    const safeId = String(receiptId).replace(/[^a-zA-Z0-9_-]/g, '');
    const metaPath = path.join(UPLOADS_DIR, `receipt_${safeId}.meta.json`);
    if (fs.existsSync(metaPath)) {
      const parsed = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      if (parsed && parsed.dataUrl) return parsed.dataUrl;
    }
  } catch {}
  return null;
}

function receiptToFirestoreFields(rec: any): Record<string, any> {
  const id = String(rec?.id || `rec-${Date.now()}`);
  const fields: Record<string, any> = {
    id: { stringValue: id },
    userId: { stringValue: String(rec?.userId || 'user') },
    userDisplayName: { stringValue: String(rec?.userDisplayName || 'Usuario') },
    userEmail: { stringValue: String(rec?.userEmail || '') },
    plan: { stringValue: String(rec?.plan || 'monthly') },
    amount: { doubleValue: Number(rec?.amount) || 1 },
    currency: { stringValue: String(rec?.currency || 'USD') },
    paymentMethod: { stringValue: String(rec?.paymentMethod || 'Transferencia') },
    referenceCode: { stringValue: String(rec?.referenceCode || '') },
    receiptFileName: { stringValue: String(rec?.receiptFileName || 'comprobante.jpg') },
    notes: { stringValue: String(rec?.notes || '') },
    whatsappContact: { stringValue: String(rec?.whatsappContact || '+54 9 11 6554-6038') },
    status: { stringValue: String(rec?.status || 'pending') },
    createdAt: { stringValue: String(rec?.createdAt || new Date().toISOString()) },
    updatedAt: { stringValue: new Date().toISOString() },
  };

  if (rec?.userAvatar && String(rec.userAvatar).length < 250000) {
    fields.userAvatar = { stringValue: String(rec.userAvatar) };
  }
  // Firestore documents have a 1MB limit; if the image dataURL is < 750KB, store directly in Firestore,
  // otherwise store the server endpoint URL `/api/vault/receipts/${id}/image` so Firestore always succeeds!
  const imgUrl = String(rec?.receiptImageUrl || '');
  if (imgUrl && imgUrl.length < 750000) {
    fields.receiptImageUrl = { stringValue: imgUrl };
  } else if (imgUrl) {
    fields.receiptImageUrl = { stringValue: `/api/vault/receipts/${encodeURIComponent(id)}/image` };
  }

  if (rec?.reviewedAt) fields.reviewedAt = { stringValue: String(rec.reviewedAt) };
  if (rec?.reviewedBy) fields.reviewedBy = { stringValue: String(rec.reviewedBy) };
  if (rec?.adminNote !== undefined) fields.adminNote = { stringValue: String(rec.adminNote) };
  if (rec?.membershipStartsAt) fields.membershipStartsAt = { stringValue: String(rec.membershipStartsAt) };
  if (rec?.membershipExpiresAt) fields.membershipExpiresAt = { stringValue: String(rec.membershipExpiresAt) };

  return fields;
}

function parseFirestoreReceiptDoc(docSnap: any, deletedSet: Set<string>): Record<string, any> | null {
  if (!docSnap || !docSnap.fields) return null;
  const fields = docSnap.fields;
  const docId = docSnap.name ? docSnap.name.split('/').pop() || '' : '';
  const id = fields.id?.stringValue || docId;
  if (!id || deletedSet.has(id) || String(id).startsWith('rec-demo')) return null;

  const amountVal =
    fields.amount?.doubleValue !== undefined
      ? Number(fields.amount.doubleValue)
      : fields.amount?.integerValue !== undefined
      ? Number(fields.amount.integerValue)
      : 1;

  let imgUrl = fields.receiptImageUrl?.stringValue || '';
  if (!imgUrl || imgUrl.startsWith('/api/vault/receipts/')) {
    const diskImg = loadReceiptImageFromDisk(id);
    if (diskImg) imgUrl = diskImg;
  }

  const rec: Record<string, any> = {
    id,
    userId: fields.userId?.stringValue || 'user',
    userDisplayName: fields.userDisplayName?.stringValue || 'Usuario',
    userEmail: fields.userEmail?.stringValue || '',
    plan: fields.plan?.stringValue || 'monthly',
    amount: amountVal,
    currency: fields.currency?.stringValue || 'USD',
    paymentMethod: fields.paymentMethod?.stringValue || 'Transferencia',
    referenceCode: fields.referenceCode?.stringValue || '',
    receiptImageUrl: imgUrl,
    receiptFileName: fields.receiptFileName?.stringValue || 'comprobante.jpg',
    notes: fields.notes?.stringValue || '',
    whatsappContact: fields.whatsappContact?.stringValue || '+54 9 11 6554-6038',
    status: fields.status?.stringValue || 'pending',
    createdAt: fields.createdAt?.stringValue || new Date().toISOString(),
  };

  if (fields.userAvatar?.stringValue) rec.userAvatar = fields.userAvatar.stringValue;
  if (fields.reviewedAt?.stringValue) rec.reviewedAt = fields.reviewedAt.stringValue;
  if (fields.reviewedBy?.stringValue) rec.reviewedBy = fields.reviewedBy.stringValue;
  if (fields.adminNote?.stringValue !== undefined) rec.adminNote = fields.adminNote.stringValue;
  if (fields.membershipStartsAt?.stringValue) rec.membershipStartsAt = fields.membershipStartsAt.stringValue;
  if (fields.membershipExpiresAt?.stringValue) rec.membershipExpiresAt = fields.membershipExpiresAt.stringValue;

  if (imgUrl && imgUrl.startsWith('data:image/')) {
    saveReceiptImageToDisk(rec);
  }

  return rec;
}

async function fetchSingleReceiptFromFirestoreREST(receiptId: string, deletedSet: Set<string>): Promise<any | null> {
  if (isServerFirestoreQuotaExhausted() || !receiptId) return null;
  try {
    const res = await serverFirestoreFetch(`/payment_receipts/${encodeURIComponent(String(receiptId))}`);
    if (!res || !res.ok) return null;
    const docSnap: any = await res.json();
    return parseFirestoreReceiptDoc(docSnap, deletedSet);
  } catch {
    return null;
  }
}

async function saveReceiptsRegistryToFirestoreREST(receipts: any[], deletedIds?: string[]): Promise<boolean> {
  if (isServerFirestoreQuotaExhausted()) return false;
  try {
    const delArr = deletedIds || Array.from(readDeletedReceiptIds());
    const delSet = new Set(delArr);
    const clean = (Array.isArray(receipts) ? receipts : []).filter(
      (r) => r && r.id && !delSet.has(r.id) && !String(r.id).startsWith('rec-demo')
    );

    let serialized = JSON.stringify(clean);
    if (serialized.length > 650000) {
      const compact = clean.map((r, idx) => {
        if (idx > 2 && r.receiptImageUrl && String(r.receiptImageUrl).length > 180000) {
          return {
            ...r,
            receiptImageUrl: `/api/vault/receipts/${encodeURIComponent(r.id)}/image`,
          };
        }
        return r;
      });
      serialized = JSON.stringify(compact);
      if (serialized.length > 750000) {
        const ultraCompact = clean.map((r) => ({
          ...r,
          receiptImageUrl: `/api/vault/receipts/${encodeURIComponent(r.id)}/image`,
        }));
        serialized = JSON.stringify(ultraCompact);
      }
    }

    const res = await serverFirestoreFetch('/system_config/receipts_registry', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fields: {
          receiptsJson: { stringValue: serialized },
          receiptIds: {
            arrayValue: {
              values: clean.map((r) => ({ stringValue: String(r.id) })),
            },
          },
          deletedIds: {
            arrayValue: {
              values: delArr.map((id) => ({ stringValue: String(id) })),
            },
          },
          updatedAt: { stringValue: new Date().toISOString() },
        },
      }),
    });
    return Boolean(res && res.ok);
  } catch {
    return false;
  }
}

async function saveReceiptToFirestoreREST(rec: any, allReceipts?: any[]): Promise<boolean> {
  if (isServerFirestoreQuotaExhausted()) return false;
  try {
    if (!rec || !rec.id) return false;
    const id = String(rec.id);
    const fields = receiptToFirestoreFields(rec);
    const res = await serverFirestoreFetch(`/payment_receipts/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields }),
    });
    await saveReceiptsRegistryToFirestoreREST(allReceipts || readReceipts());
    return Boolean(res && res.ok);
  } catch {
    return false;
  }
}

async function deleteReceiptFromFirestoreREST(receiptId: string, customList?: any[]): Promise<boolean> {
  if (isServerFirestoreQuotaExhausted()) return false;
  try {
    addDeletedReceiptId(receiptId);
    await serverFirestoreFetch(`/payment_receipts/${encodeURIComponent(String(receiptId))}`, {
      method: 'DELETE',
    });
    const currentList = customList || readReceipts().filter((r: any) => r.id !== receiptId);
    await saveReceiptsRegistryToFirestoreREST(currentList, Array.from(readDeletedReceiptIds()));
    return true;
  } catch {
    return false;
  }
}

async function fetchAllReceiptsFromFirestoreREST(): Promise<any[]> {
  const map = new Map<string, any>();
  if (isServerFirestoreQuotaExhausted()) return [];
  const deletedSet = readDeletedReceiptIds();

  try {
    const res = await serverFirestoreFetch('/system_config/receipts_registry');
    if (res && res.ok) {
      const docSnap: any = await res.json();
      const fields = docSnap?.fields || {};
      if (Array.isArray(fields.deletedIds?.arrayValue?.values)) {
        for (const v of fields.deletedIds.arrayValue.values) {
          if (v?.stringValue) {
            deletedSet.add(String(v.stringValue));
            addDeletedReceiptId(String(v.stringValue));
          }
        }
      }
      if (fields.receiptsJson?.stringValue) {
        try {
          const parsed = JSON.parse(fields.receiptsJson.stringValue);
          if (Array.isArray(parsed)) {
            for (const r of parsed) {
              if (r && r.id && !deletedSet.has(r.id) && !String(r.id).startsWith('rec-demo')) {
                if (!r.receiptImageUrl || !String(r.receiptImageUrl).startsWith('data:image/')) {
                  const diskImg = loadReceiptImageFromDisk(r.id);
                  if (diskImg) {
                    r.receiptImageUrl = diskImg;
                  }
                } else {
                  saveReceiptImageToDisk(r);
                }
                map.set(r.id, r);
              }
            }
          }
        } catch {}
      }
    }
  } catch {}

  return Array.from(map.values());
}

function mergeReceiptRecords(existing: any, incoming: any): any {
  if (!existing) return incoming;
  if (!incoming) return existing;

  const existingTime = existing.reviewedAt ? new Date(existing.reviewedAt).getTime() : 0;
  const incomingTime = incoming.reviewedAt ? new Date(incoming.reviewedAt).getTime() : 0;

  const base = incomingTime >= existingTime ? { ...existing, ...incoming } : { ...incoming, ...existing };

  // Always preserve the full data:image URL if one record has it and the other only has a path or empty string
  const existingImg = String(existing.receiptImageUrl || '');
  const incomingImg = String(incoming.receiptImageUrl || '');
  if (existingImg.startsWith('data:image/') && !incomingImg.startsWith('data:image/')) {
    base.receiptImageUrl = existingImg;
  } else if (incomingImg.startsWith('data:image/')) {
    base.receiptImageUrl = incomingImg;
  }

  return base;
}

// GET /api/vault/receipts/:id/image - Serve stored receipt image
app.get('/api/vault/receipts/:id/image', async (req, res) => {
  try {
    const { id } = req.params;
    const safeId = String(id).replace(/[^a-zA-Z0-9_-]/g, '');
    const binPath = path.join(UPLOADS_DIR, `receipt_${safeId}.bin`);
    const metaPath = path.join(UPLOADS_DIR, `receipt_${safeId}.meta.json`);
    if (fs.existsSync(binPath) && fs.existsSync(metaPath)) {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      res.setHeader('Content-Type', meta.mimeType || 'image/jpeg');
      return res.sendFile(binPath);
    }

    const receipts = readReceipts();
    let found = receipts.find((r) => r.id === id);
    if (!found || !found.receiptImageUrl || !String(found.receiptImageUrl).startsWith('data:image/')) {
      const fromFs = await fetchSingleReceiptFromFirestoreREST(id, readDeletedReceiptIds());
      if (fromFs && fromFs.receiptImageUrl && String(fromFs.receiptImageUrl).startsWith('data:image/')) {
        found = fromFs;
      }
    }

    if (found && found.receiptImageUrl && String(found.receiptImageUrl).startsWith('data:image/')) {
      const matches = String(found.receiptImageUrl).match(/^data:(image\/[A-Za-z0-9.+-]+);base64,(.+)$/);
      if (matches && matches.length === 3) {
        res.setHeader('Content-Type', matches[1]);
        return res.send(Buffer.from(matches[2], 'base64'));
      }
    }
    return res.status(404).send('Imagen no encontrada');
  } catch {
    return res.status(500).send('Error al cargar imagen');
  }
});

// POST /api/vault/receipts/upload-image - Upload receipt screenshot directly to disk
app.post('/api/vault/receipts/upload-image', uploadMiddleware.single('image') as any, (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ success: false, error: 'No se recibió ninguna imagen' });
    }
    const rawId = req.body?.receiptId || req.query?.receiptId || `rec-${Date.now()}`;
    const safeId = String(rawId).replace(/[^a-zA-Z0-9_-]/g, '');

    // Move or save to receipt_${safeId}.bin
    const binPath = path.join(UPLOADS_DIR, `receipt_${safeId}.bin`);
    const metaPath = path.join(UPLOADS_DIR, `receipt_${safeId}.meta.json`);

    fs.copyFileSync(file.path, binPath);
    const mimeType = file.mimetype || 'image/jpeg';
    fs.writeFileSync(metaPath, JSON.stringify({ mimeType, originalName: file.originalname, size: file.size }), 'utf-8');

    const imageUrl = `/api/vault/receipts/${encodeURIComponent(safeId)}/image`;
    return res.json({
      success: true,
      receiptId: safeId,
      imageUrl,
      size: file.size,
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/vault/receipts - Fetch all payment receipts (Merged from Server File + Firestore REST)
app.get('/api/vault/receipts', async (_req, res) => {
  try {
    const deletedSet = readDeletedReceiptIds();
    const localReceipts = readReceipts();
    const firestoreReceipts = await fetchAllReceiptsFromFirestoreREST();

    const receiptMap = new Map<string, any>();
    for (const r of localReceipts) {
      if (r && r.id && !deletedSet.has(r.id)) {
        receiptMap.set(r.id, r);
      }
    }
    for (const r of firestoreReceipts) {
      if (r && r.id && !deletedSet.has(r.id)) {
        const existing = receiptMap.get(r.id);
        receiptMap.set(r.id, mergeReceiptRecords(existing, r));
      }
    }

    const merged = Array.from(receiptMap.values()).sort(
      (a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
    );

    writeReceipts(merged);
    return res.json({ success: true, receipts: merged, deletedIds: Array.from(deletedSet), total: merged.length });
  } catch (err: any) {
    const deletedSet = readDeletedReceiptIds();
    const localReceipts = readReceipts().filter((r: any) => r && r.id && !deletedSet.has(r.id));
    return res.json({ success: true, receipts: localReceipts, deletedIds: Array.from(deletedSet), total: localReceipts.length });
  }
});

// POST /api/vault/receipts - Create or update a payment receipt
app.post('/api/vault/receipts', async (req, res) => {
  try {
    const newReceipt = req.body;
    if (!newReceipt || !newReceipt.id || !newReceipt.userId) {
      return res.status(400).json({ success: false, error: 'Datos de comprobante incompletos' });
    }

    removeDeletedReceiptId(newReceipt.id);
    saveReceiptImageToDisk(newReceipt);

    const currentReceipts = readReceipts();
    const existingIndex = currentReceipts.findIndex((r) => r.id === newReceipt.id);
    let updatedReceipts: any[];

    if (existingIndex >= 0) {
      updatedReceipts = [...currentReceipts];
      updatedReceipts[existingIndex] = mergeReceiptRecords(updatedReceipts[existingIndex], newReceipt);
    } else {
      updatedReceipts = [newReceipt, ...currentReceipts];
    }

    updatedReceipts.sort(
      (a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
    );

    writeReceipts(updatedReceipts);
    const savedTarget = existingIndex >= 0 ? updatedReceipts[existingIndex] : newReceipt;
    saveReceiptToFirestoreREST(savedTarget, updatedReceipts).catch(() => {});

    return res.json({
      success: true,
      receipt: savedTarget,
      receipts: updatedReceipts,
      firestoreSynced: true,
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/vault/receipts/sync - Two-way batch sync of receipts between Client, Server, and Firestore
app.post('/api/vault/receipts/sync', async (req, res) => {
  try {
    const { receipts: incomingReceipts, deletedIds: incomingDeletedIds } = req.body;
    if (Array.isArray(incomingDeletedIds)) {
      for (const delId of incomingDeletedIds) {
        if (typeof delId === 'string' && delId.trim()) {
          addDeletedReceiptId(delId.trim());
        }
      }
    }
    const deletedSet = readDeletedReceiptIds();
    const localReceipts = readReceipts();
    const firestoreReceipts = await fetchAllReceiptsFromFirestoreREST();

    const receiptMap = new Map<string, any>();

    for (const r of localReceipts) {
      if (r && r.id && !deletedSet.has(r.id)) {
        receiptMap.set(r.id, r);
      }
    }
    for (const r of firestoreReceipts) {
      if (r && r.id && !deletedSet.has(r.id)) {
        receiptMap.set(r.id, mergeReceiptRecords(receiptMap.get(r.id), r));
      }
    }
    if (Array.isArray(incomingReceipts)) {
      for (const r of incomingReceipts) {
        if (r && r.id && !deletedSet.has(r.id) && !String(r.id).startsWith('rec-demo')) {
          saveReceiptImageToDisk(r);
          receiptMap.set(r.id, mergeReceiptRecords(receiptMap.get(r.id), r));
        }
      }
    }

    const merged = Array.from(receiptMap.values()).sort(
      (a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
    );

    const prevIds = new Set(firestoreReceipts.map((r) => r.id));
    const hasNewOrChanged =
      merged.length !== firestoreReceipts.length ||
      merged.some((r) => !prevIds.has(r.id));

    writeReceipts(merged);

    if (hasNewOrChanged) {
      saveReceiptsRegistryToFirestoreREST(merged, Array.from(deletedSet)).catch(() => {});
      for (const r of merged) {
        if (!prevIds.has(r.id)) {
          saveReceiptToFirestoreREST(r, merged).catch(() => {});
        }
      }
    }

    return res.json({
      success: true,
      receipts: merged,
      deletedIds: Array.from(deletedSet),
      total: merged.length,
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH /api/vault/receipts/:id/status - Update approval status and immediately delete from approvals queue (Admin)
app.patch('/api/vault/receipts/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status, amount: bodyAmount, adminNote, reviewerName, receipt: fullReceipt } = req.body;

    if (!['pending', 'approved', 'rejected'].includes(status)) {
      return res.status(400).json({ success: false, error: 'Estado de comprobante inválido' });
    }

    const currentReceipts = readReceipts();
    let targetIndex = currentReceipts.findIndex((r) => r.id === id);

    // If receipt was not yet on server disk, check Firestore or use fullReceipt provided in body
    if (targetIndex < 0 && fullReceipt && fullReceipt.id === id) {
      currentReceipts.unshift(fullReceipt);
      targetIndex = 0;
    } else if (targetIndex < 0) {
      const fsReceipts = await fetchAllReceiptsFromFirestoreREST();
      const foundFs = fsReceipts.find((r) => r.id === id);
      if (foundFs) {
        currentReceipts.unshift(foundFs);
        targetIndex = 0;
      }
    }

    const target = targetIndex >= 0 ? currentReceipts[targetIndex] : fullReceipt || { id, amount: 1, plan: 'monthly' };
    const now = new Date();
    const nowIso = now.toISOString();

    const rawAmount = Number(bodyAmount ?? fullReceipt?.amount ?? target.amount);
    const validAmount =
      !isNaN(rawAmount) && rawAmount > 0
        ? Math.round(rawAmount * 100) / 100
        : target.plan === 'annual'
        ? 12
        : 1;
    const resolvedPlan = validAmount >= 12 ? 'annual' : 'monthly';
    const durationDays =
      validAmount >= 12
        ? Math.max(365, Math.round((validAmount / 12) * 365))
        : Math.max(1, Math.round(validAmount * 30));
    const expiresIso = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000).toISOString();

    const updated = {
      ...target,
      plan: resolvedPlan,
      amount: validAmount,
      status,
      adminNote: adminNote !== undefined ? adminNote : target.adminNote,
      reviewedAt: nowIso,
      reviewedBy: reviewerName || 'Administrador',
      membershipStartsAt: status === 'approved' ? nowIso : undefined,
      membershipExpiresAt: status === 'approved' ? expiresIso : undefined,
    };

    // ELIMINAR el comprobante de la lista de aprobaciones activas inmediatamente como se requiere
    addDeletedReceiptId(id);
    const updatedReceiptsList = currentReceipts.filter((r) => r.id !== id);
    writeReceipts(updatedReceiptsList);
    await deleteReceiptFromFirestoreREST(id, updatedReceiptsList);

    // Also update the user's membership in users.json + Firestore immediately according to the receipt amount
    try {
      const usersMap = readRegisteredUsersMap();
      const userEmailKey = String(updated.userEmail || '').toLowerCase().trim();
      let matchedEmailKey = userEmailKey && usersMap[userEmailKey] ? userEmailKey : '';
      if (!matchedEmailKey && updated.userId) {
        for (const [k, rec] of Object.entries(usersMap)) {
          if (rec?.profile?.uid === updated.userId) {
            matchedEmailKey = k;
            break;
          }
        }
      }

      if (status === 'approved') {
        const targetKey = matchedEmailKey || userEmailKey || `${updated.userId}@vault.user`;
        const existingRec = usersMap[targetKey] || {
          email: targetKey,
          password: 'password123',
          registeredAt: nowIso,
          profile: {
            uid: updated.userId || `usr_${Date.now()}`,
            email: targetKey,
            displayName: updated.userDisplayName || targetKey.split('@')[0] || 'Miembro VIP',
            role: 'vip_member',
            joinedAt: nowIso.split('T')[0],
          },
        };
        const isUserAdmin = existingRec.profile?.role === 'admin';
        existingRec.profile = {
          ...(existingRec.profile || {}),
          membershipPlan: resolvedPlan,
          membershipStatus: 'active',
          tier: isUserAdmin ? 'Bóveda Diamante' : 'Acceso VIP',
          subscribedAt: nowIso,
          membershipExpiresAt: expiresIso,
          lastPaymentAmount: validAmount,
        };
        usersMap[targetKey] = existingRec;
        writeRegisteredUsersMap(usersMap);
        saveUserToFirestoreREST(existingRec).catch(() => {});
      } else if (status === 'rejected' && matchedEmailKey && usersMap[matchedEmailKey]) {
        const existingRec = usersMap[matchedEmailKey];
        const isUserAdmin = existingRec.profile?.role === 'admin';
        existingRec.profile = {
          ...(existingRec.profile || {}),
          membershipPlan: undefined,
          membershipStatus: 'none',
          tier: isUserAdmin ? 'Bóveda Diamante' : 'Invitado',
          subscribedAt: undefined,
          membershipExpiresAt: undefined,
          customStatus: updated.adminNote
            ? `Membresía no aprobada: ${updated.adminNote}`
            : undefined,
        };
        usersMap[matchedEmailKey] = existingRec;
        writeRegisteredUsersMap(usersMap);
        saveUserToFirestoreREST(existingRec).catch(() => {});
      }
    } catch (userUpdateErr) {
      console.warn('Error updating user membership on receipt status change:', userUpdateErr);
    }

    return res.json({
      success: true,
      deletedId: id,
      deletedIds: Array.from(readDeletedReceiptIds()),
      receipt: updated,
      receipts: updatedReceiptsList,
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/vault/receipts/:id - Delete receipt and purge permanently
app.delete('/api/vault/receipts/:id', async (req, res) => {
  try {
    const { id } = req.params;
    addDeletedReceiptId(id);
    const currentReceipts = readReceipts();
    const updated = currentReceipts.filter((r) => r.id !== id);
    writeReceipts(updated);
    await deleteReceiptFromFirestoreREST(id, updated);
    return res.json({
      success: true,
      deletedId: id,
      deletedIds: Array.from(readDeletedReceiptIds()),
      receipts: updated,
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// --- REGISTERED USER ACCOUNTS PERSISTENCE (Server File + Firestore REST) ---

const DEFAULT_SEED_USERS: Record<string, any> = {
  'astroarg02@gmail.com': {
    email: 'astroarg02@gmail.com',
    password: ADMIN_SECURITY_KEY,
    registeredAt: '2025-01-01T00:00:00.000Z',
    profile: {
      uid: 'admin_master_astro',
      email: 'astroarg02@gmail.com',
      displayName: 'Administrador (astroarg02)',
      role: 'admin',
      joinedAt: '2025-01-01',
      tier: 'Bóveda Diamante',
      membershipStatus: 'none',
      avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
      bio: 'Administrador central de Bóveda App 66. Gestión de contenidos y verificaciones.',
      phone: '+54 9 11 6554-6038',
      customStatus: '🛡️ En línea - Modo Administrador',
    },
  },
  'cuentaninja989@gmail.com': {
    email: 'cuentaninja989@gmail.com',
    password: ADMIN_SECURITY_KEY,
    registeredAt: '2025-01-15T00:00:00.000Z',
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
  },
  'member@vault.com': {
    email: 'member@vault.com',
    password: 'password123',
    registeredAt: '2025-02-14T00:00:00.000Z',
    profile: {
      uid: 'vip_user_449',
      email: 'member@vault.com',
      displayName: 'Alex Rivera (VIP)',
      role: 'vip_member',
      joinedAt: '2025-02-14',
      tier: 'Invitado',
      membershipStatus: 'none',
      avatarUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80',
      bio: 'Miembro VIP de la comunidad. Acceso a recursos exclusivos.',
      customStatus: '💎 Miembro VIP',
    },
  },
};

if (!fs.existsSync(USERS_FILE)) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(DEFAULT_SEED_USERS, null, 2), 'utf-8');
}

function readRegisteredUsersMap(): Record<string, any> {
  try {
    if (fs.existsSync(USERS_FILE)) {
      const raw = fs.readFileSync(USERS_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return { ...DEFAULT_SEED_USERS, ...parsed };
      }
    }
  } catch (err) {
    console.error('Error reading users from file:', err);
  }
  return { ...DEFAULT_SEED_USERS };
}

function writeRegisteredUsersMap(usersMap: Record<string, any>): boolean {
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify(usersMap, null, 2), 'utf-8');
    return true;
  } catch (err) {
    console.error('Error writing users to file:', err);
    return false;
  }
}

function mergeUserProfileOnServer(existingProf: any, incomingProf: any): any {
  if (!existingProf) return { ...(incomingProf || {}) };
  if (!incomingProf) return { ...(existingProf || {}) };

  const existingTime = existingProf?.updatedAt ? new Date(existingProf.updatedAt).getTime() : 0;
  const incomingTime = incomingProf?.updatedAt ? new Date(incomingProf.updatedAt).getTime() : 0;
  const validExistingTime = isNaN(existingTime) ? 0 : existingTime;
  const validIncomingTime = isNaN(incomingTime) ? 0 : incomingTime;

  // The profile with the newer updatedAt timestamp wins for user-editable profile fields
  const existingIsNewer = validExistingTime > validIncomingTime;
  const base = existingIsNewer
    ? { ...incomingProf, ...existingProf }
    : { ...existingProf, ...incomingProf };

  if (existingIsNewer) {
    base.displayName = existingProf.displayName ?? incomingProf.displayName;
    base.avatarUrl = existingProf.avatarUrl ?? incomingProf.avatarUrl;
    base.bio = existingProf.bio !== undefined ? existingProf.bio : incomingProf.bio;
    base.phone = existingProf.phone !== undefined ? existingProf.phone : incomingProf.phone;
    base.instagram = existingProf.instagram !== undefined ? existingProf.instagram : incomingProf.instagram;
    base.customStatus = existingProf.customStatus !== undefined ? existingProf.customStatus : incomingProf.customStatus;
    base.updatedAt = existingProf.updatedAt;
  } else if (validIncomingTime > validExistingTime) {
    base.displayName = incomingProf.displayName ?? existingProf.displayName;
    base.avatarUrl = incomingProf.avatarUrl ?? existingProf.avatarUrl;
    base.bio = incomingProf.bio !== undefined ? incomingProf.bio : existingProf.bio;
    base.phone = incomingProf.phone !== undefined ? incomingProf.phone : existingProf.phone;
    base.instagram = incomingProf.instagram !== undefined ? incomingProf.instagram : existingProf.instagram;
    base.customStatus = incomingProf.customStatus !== undefined ? incomingProf.customStatus : existingProf.customStatus;
    base.updatedAt = incomingProf.updatedAt;
  }

  // Preserve active membership if existingProf has an active membership and incomingProf has 'none' (from a stale client sync)
  if (
    existingProf?.membershipStatus === 'active' &&
    existingProf?.subscribedAt &&
    incomingProf?.membershipStatus === 'none' &&
    !String(incomingProf?.customStatus || '').startsWith('Membresía no aprobada:')
  ) {
    base.membershipStatus = 'active';
    base.membershipPlan = existingProf.membershipPlan;
    base.subscribedAt = existingProf.subscribedAt;
    base.membershipExpiresAt = existingProf.membershipExpiresAt;
    base.lastPaymentAmount = existingProf.lastPaymentAmount;
    base.tier = existingProf.role === 'admin' ? 'Bóveda Diamante' : 'Acceso VIP';
  } else if (
    incomingProf?.membershipStatus === 'active' &&
    incomingProf?.subscribedAt &&
    existingProf?.membershipStatus === 'none' &&
    !String(existingProf?.customStatus || '').startsWith('Membresía no aprobada:')
  ) {
    base.membershipStatus = 'active';
    base.membershipPlan = incomingProf.membershipPlan;
    base.subscribedAt = incomingProf.subscribedAt;
    base.membershipExpiresAt = incomingProf.membershipExpiresAt;
    base.lastPaymentAmount = incomingProf.lastPaymentAmount;
    base.tier = incomingProf.role === 'admin' ? 'Bóveda Diamante' : 'Acceso VIP';
  }
  return base;
}

function userRecordToFirestoreFields(record: any): Record<string, any> {
  const prof = record?.profile || record || {};
  const email = String(record?.email || prof?.email || '').toLowerCase().trim();
  const uid = String(prof?.uid || `usr_${Date.now()}`);
  const fields: Record<string, any> = {
    uid: { stringValue: uid },
    email: { stringValue: email },
    password: { stringValue: String(record?.password || 'password123') },
    registeredAt: { stringValue: String(record?.registeredAt || new Date().toISOString()) },
    displayName: { stringValue: String(prof?.displayName || email.split('@')[0] || 'Usuario') },
    role: { stringValue: String(prof?.role || 'vip_member') },
    tier: { stringValue: String(prof?.tier || 'Invitado') },
    joinedAt: { stringValue: String(prof?.joinedAt || new Date().toISOString().split('T')[0]) },
    membershipStatus: { stringValue: String(prof?.membershipStatus || 'none') },
    updatedAt: { stringValue: String(prof?.updatedAt || new Date().toISOString()) },
    bio: { stringValue: String(prof?.bio ?? '') },
    phone: { stringValue: String(prof?.phone ?? '') },
    customStatus: { stringValue: String(prof?.customStatus ?? '') },
    instagram: { stringValue: String(prof?.instagram ?? '') },
  };

  if (prof?.avatarUrl) fields.avatarUrl = { stringValue: String(prof.avatarUrl) };
  if (prof?.membershipPlan) fields.membershipPlan = { stringValue: String(prof.membershipPlan) };
  if (prof?.subscribedAt) fields.subscribedAt = { stringValue: String(prof.subscribedAt) };
  if (prof?.membershipExpiresAt) fields.membershipExpiresAt = { stringValue: String(prof.membershipExpiresAt) };
  if (typeof prof?.lastPaymentAmount === 'number') {
    fields.lastPaymentAmount = Number.isInteger(prof.lastPaymentAmount)
      ? { integerValue: String(prof.lastPaymentAmount) }
      : { doubleValue: Number(prof.lastPaymentAmount) };
  }

  return fields;
}

async function saveUsersRegistryToFirestoreREST(usersMap?: Record<string, any>): Promise<boolean> {
  if (isServerFirestoreQuotaExhausted()) return false;
  try {
    const mapToSave = usersMap || readRegisteredUsersMap();
    const compactMap: Record<string, any> = {};
    for (const [k, v] of Object.entries(mapToSave)) {
      if (!v) continue;
      const prof = v.profile || {};
      compactMap[k] = {
        ...v,
        profile: {
          ...prof,
          avatarUrl:
            prof.avatarUrl && String(prof.avatarUrl).length > 180000
              ? `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(prof.uid || k)}`
              : prof.avatarUrl,
        },
      };
    }
    const res = await serverFirestoreFetch('/system_config/users_registry', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fields: {
          usersJson: { stringValue: JSON.stringify(compactMap) },
          updatedAt: { stringValue: new Date().toISOString() },
        },
      }),
    });
    return Boolean(res && res.ok);
  } catch {
    return false;
  }
}

async function saveUserToFirestoreREST(record: any, usersMap?: Record<string, any>): Promise<boolean> {
  if (isServerFirestoreQuotaExhausted()) return false;
  try {
    const prof = record?.profile || record;
    const uid = prof?.uid;
    if (!uid) return false;
    const fields = userRecordToFirestoreFields(record);
    const res = await serverFirestoreFetch(`/users/${encodeURIComponent(String(uid))}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields }),
    });
    await saveUsersRegistryToFirestoreREST(usersMap);
    return Boolean(res && res.ok);
  } catch {
    return false;
  }
}

async function fetchAllUsersFromFirestoreREST(): Promise<Record<string, any>> {
  const result: Record<string, any> = {};
  if (isServerFirestoreReadQuotaExhausted()) return result;
  try {
    const res = await serverFirestoreFetch('/system_config/users_registry');
    if (res && res.ok) {
      const docSnap: any = await res.json();
      const rawJson = docSnap?.fields?.usersJson?.stringValue;
      if (rawJson) {
        try {
          const parsed = JSON.parse(rawJson);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            Object.assign(result, parsed);
          }
        } catch {}
      }
    }
  } catch {}
  return result;
}

// GET /api/vault/users - Fetch all registered user accounts (Server + Firestore)
app.get('/api/vault/users', async (_req, res) => {
  try {
    const localUsers = readRegisteredUsersMap();
    const firestoreUsers = await fetchAllUsersFromFirestoreREST();

    const merged: Record<string, any> = { ...localUsers };
    for (const [emailKey, fsRecord] of Object.entries(firestoreUsers)) {
      const existing = merged[emailKey];
      if (!existing) {
        merged[emailKey] = fsRecord;
      } else {
        merged[emailKey] = {
          ...existing,
          ...fsRecord,
          password: fsRecord.password && fsRecord.password !== 'password123' ? fsRecord.password : (existing.password || fsRecord.password || 'password123'),
          profile: mergeUserProfileOnServer(existing.profile, fsRecord.profile),
        };
      }
    }

    writeRegisteredUsersMap(merged);
    return res.json({ success: true, accounts: merged, total: Object.keys(merged).length });
  } catch (err: any) {
    const localUsers = readRegisteredUsersMap();
    return res.json({ success: true, accounts: localUsers, total: Object.keys(localUsers).length });
  }
});

// POST /api/vault/users - Save or update a single registered user account in Database + Firestore
app.post('/api/vault/users', async (req, res) => {
  try {
    const body = req.body;
    const profile = body?.profile || body;
    const rawEmail = body?.email || profile?.email;
    if (!rawEmail) {
      return res.status(400).json({ success: false, error: 'Email requerido para guardar la cuenta' });
    }

    const emailKey = String(rawEmail).toLowerCase().trim();
    const currentMap = readRegisteredUsersMap();
    const existing = currentMap[emailKey];
    const nowIso = new Date().toISOString();

    const incomingProfileWithTimestamp = {
      ...(profile || {}),
      email: emailKey,
      updatedAt: profile?.updatedAt || nowIso,
    };

    const record = {
      email: emailKey,
      password:
        body?.password && body.password !== 'password123'
          ? body.password
          : existing?.password || body?.password || 'password123',
      registeredAt: body?.registeredAt || existing?.registeredAt || nowIso,
      profile: mergeUserProfileOnServer(existing?.profile, incomingProfileWithTimestamp),
    };

    currentMap[emailKey] = record;
    writeRegisteredUsersMap(currentMap);

    const firestoreSynced = await saveUserToFirestoreREST(record, currentMap);

    return res.json({
      success: true,
      account: record,
      firestoreSynced,
      total: Object.keys(currentMap).length,
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/vault/users/sync - Batch synchronize all registered accounts to Database + Firestore
app.post('/api/vault/users/sync', async (req, res) => {
  try {
    const { accounts } = req.body;
    const currentMap = readRegisteredUsersMap();
    const firestoreUsers = await fetchAllUsersFromFirestoreREST();

    // Merge Firestore users first
    for (const [emailKey, fsRecord] of Object.entries(firestoreUsers)) {
      if (!currentMap[emailKey]) {
        currentMap[emailKey] = fsRecord;
      } else {
        currentMap[emailKey] = {
          ...currentMap[emailKey],
          profile: mergeUserProfileOnServer(currentMap[emailKey].profile, fsRecord.profile),
        };
      }
    }

    // Merge incoming client accounts
    const incomingEntries: any[] = [];
    if (Array.isArray(accounts)) {
      incomingEntries.push(...accounts);
    } else if (accounts && typeof accounts === 'object') {
      incomingEntries.push(...Object.values(accounts));
    }

    let hasChangesForFirestore = false;
    for (const entry of incomingEntries) {
      const prof = entry?.profile || entry;
      const emailKey = String(entry?.email || prof?.email || '').toLowerCase().trim();
      if (!emailKey) continue;

      const existing = currentMap[emailKey];
      const mergedProf = {
        ...mergeUserProfileOnServer(existing?.profile, prof),
        email: emailKey,
      };
      if (
        !firestoreUsers[emailKey] ||
        firestoreUsers[emailKey]?.profile?.updatedAt !== mergedProf.updatedAt ||
        firestoreUsers[emailKey]?.profile?.membershipStatus !== mergedProf.membershipStatus
      ) {
        hasChangesForFirestore = true;
      }
      currentMap[emailKey] = {
        email: emailKey,
        password:
          entry?.password && entry.password !== 'password123'
            ? entry.password
            : existing?.password || entry?.password || 'password123',
        registeredAt: entry?.registeredAt || existing?.registeredAt || new Date().toISOString(),
        profile: mergedProf,
      };
    }

    writeRegisteredUsersMap(currentMap);
    if (hasChangesForFirestore) {
      saveUsersRegistryToFirestoreREST(currentMap).catch(() => {});
    }

    return res.json({
      success: true,
      accounts: currentMap,
      total: Object.keys(currentMap).length,
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Setup Vite middleware or Static serving
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', async () => {
    console.log(`Vault Server running on http://0.0.0.0:${PORT}`);

    // Lightweight non-exhaustive cloud read on startup (does not re-write existing items to preserve daily write quota)
    try {
      // 1. Sync deleted items blacklist from Firestore REST first
      try {
        const cloudDeletedItemIds = await fetchDeletedItemsFromFirestoreREST();
        if (cloudDeletedItemIds.length > 0) {
          const currentDeleted = readDeletedItemIds();
          cloudDeletedItemIds.forEach((id) => currentDeleted.add(id));
          fs.writeFileSync(DELETED_ITEMS_FILE, JSON.stringify(Array.from(currentDeleted), null, 2), 'utf-8');
        }
      } catch {}

      const deletedItemSet = readDeletedItemIds();
      const localItems = readVaultItems();
      const cloudItems = await fetchAllFromFirestoreREST();
      const itemMap = new Map<string, any>();
      for (const it of localItems) {
        if (it && it.id && !deletedItemSet.has(it.id)) itemMap.set(it.id, it);
      }
      for (const it of cloudItems) {
        if (it && it.id && !deletedItemSet.has(it.id)) {
          itemMap.set(it.id, { ...(itemMap.get(it.id) || {}), ...it });
        }
      }
      const mergedItems = Array.from(itemMap.values()).filter((it) => !deletedItemSet.has(it.id));
      writeVaultItems(mergedItems);

      const deletedListSet = readDeletedListIds();
      const localLists = readVaultLists();
      const cloudLists = await fetchAllListsFromFirestoreREST();
      const listMap = new Map<string, any>();
      for (const l of localLists) {
        if (l && l.id && !deletedListSet.has(l.id)) listMap.set(l.id, l);
      }
      for (const l of cloudLists) {
        if (l && l.id && !deletedListSet.has(l.id)) {
          listMap.set(l.id, { ...(listMap.get(l.id) || {}), ...l });
        }
      }
      const mergedLists = Array.from(listMap.values());
      if (mergedLists.length > 0) {
        writeVaultLists(mergedLists);
      }

      const localUsers = readRegisteredUsersMap();
      const cloudUsers = await fetchAllUsersFromFirestoreREST();
      const mergedUsers: Record<string, any> = { ...localUsers };
      for (const [emailKey, fsRecord] of Object.entries(cloudUsers)) {
        const existing = mergedUsers[emailKey];
        if (!existing) {
          mergedUsers[emailKey] = fsRecord;
        } else {
          mergedUsers[emailKey] = {
            ...existing,
            ...fsRecord,
            password:
              fsRecord.password && fsRecord.password !== 'password123'
                ? fsRecord.password
                : existing.password || fsRecord.password || 'password123',
            profile: mergeUserProfileOnServer(existing.profile, fsRecord.profile),
          };
        }
      }
      writeRegisteredUsersMap(mergedUsers);

      const deletedReceiptSet = readDeletedReceiptIds();
      const localReceipts = readReceipts();
      const cloudReceipts = await fetchAllReceiptsFromFirestoreREST();
      const receiptMap = new Map<string, any>();
      for (const r of localReceipts) {
        if (r && r.id && !deletedReceiptSet.has(r.id)) receiptMap.set(r.id, r);
      }
      for (const r of cloudReceipts) {
        if (r && r.id && !deletedReceiptSet.has(r.id)) receiptMap.set(r.id, mergeReceiptRecords(receiptMap.get(r.id), r));
      }
      const mergedReceipts = Array.from(receiptMap.values());
      writeReceipts(mergedReceipts);
    } catch (bootErr) {
      console.warn('[Cloud Boot Sync Error]:', bootErr);
    }
  });
}

startServer();

import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { INITIAL_ADMIN_USER, INITIAL_MEMBER_USER, INITIAL_VAULT_ITEMS, INITIAL_VAULT_LISTS, ADMIN_SECURITY_KEY, isAuthorizedAdminEmail } from './data/initialVaultData';
import { VaultItem, UserProfile, VaultComment, VaultList } from './types';
import { AuthScreen } from './components/MobileSimulator/AuthScreen';
import { VaultScreen } from './components/MobileSimulator/VaultScreen';
import { VaultDetailModal } from './components/MobileSimulator/VaultDetailModal';
import { MembershipScreen } from './components/MobileSimulator/MembershipScreen';
import { ReceiptsScreen } from './components/MobileSimulator/ReceiptsScreen';
import { AdminApprovalsScreen } from './components/MobileSimulator/AdminApprovalsScreen';
import { ProfileScreen } from './components/MobileSimulator/ProfileScreen';
import { AdminUploadModal } from './components/MobileSimulator/AdminUploadModal';
import { AdminListModal } from './components/MobileSimulator/AdminListModal';
import { receiptService } from './services/receiptService';
import { MaintenanceScreen } from './components/MaintenanceScreen';
import { AdminMaintenanceModal } from './components/AdminMaintenanceModal';
import { AdminLiveSyncModal } from './components/AdminLiveSyncModal';
import { CircularStartupLoader } from './components/CircularStartupLoader';
import { ThemeProvider, useTheme } from './context/ThemeContext';
import { firebaseService, resolveApiUrl, safeFetchApi, safeFetchJson, isStandaloneApp, getRemoteServerBaseUrl } from './services/firebaseService';
import { liveSyncService } from './services/liveSyncService';
import { supabaseService, isSupabaseConfigured } from './services/supabaseClient';
import { 
  FolderClosed, 
  Crown, 
  User, 
  Moon, 
  Sun, 
  LogOut, 
  ShieldCheck, 
  Database,
  Flame,
  Layers,
  Wrench,
  FileText,
  FileCheck,
  Eye,
  CheckCircle2,
  RefreshCw,
  Sparkles,
  Radio
} from 'lucide-react';

// Helper to manage deleted list IDs in localStorage to prevent deleted lists from resurfacing
const getDeletedListIds = (): Set<string> => {
  try {
    const raw = localStorage.getItem('vault_deleted_list_ids');
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return new Set(arr.map(String));
    }
  } catch (e) {}
  return new Set<string>();
};

const addDeletedListId = (id: string) => {
  try {
    const current = getDeletedListIds();
    current.add(id);
    localStorage.setItem('vault_deleted_list_ids', JSON.stringify(Array.from(current)));
  } catch (e) {}
};

const unmarkDeletedListId = (id: string) => {
  try {
    const current = getDeletedListIds();
    current.delete(id);
    localStorage.setItem('vault_deleted_list_ids', JSON.stringify(Array.from(current)));
  } catch (e) {}
};

function AppContent() {
  const [items, setItems] = useState<VaultItem[]>(() => {
    const local = supabaseService.getLocalVaultItems();
    return local && local.length > 0 ? local : INITIAL_VAULT_ITEMS;
  });

  const [lists, setLists] = useState<VaultList[]>(() => {
    try {
      const deletedIds = getDeletedListIds();
      const saved = localStorage.getItem('vault_lists_cache');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          return parsed.filter((l) => l && l.id && !deletedIds.has(l.id));
        }
      }
      return INITIAL_VAULT_LISTS.filter((l) => l && l.id && !deletedIds.has(l.id));
    } catch (e) {}
    return INITIAL_VAULT_LISTS;
  });

  const sanitizeUserRole = (user: UserProfile | null): UserProfile | null => {
    if (!user) return null;
    if (isAuthorizedAdminEmail(user.email)) {
      return {
        ...user,
        role: 'admin',
        tier: 'Bóveda Diamante',
      };
    }
    if (user.role === 'admin' || user.tier === 'Bóveda Diamante') {
      return {
        ...user,
        role: 'vip_member',
        tier: user.tier === 'Bóveda Diamante' ? 'Acceso VIP' : user.tier,
      };
    }
    return user;
  };

  const [currentUser, setCurrentUser] = useState<UserProfile | null>(() => sanitizeUserRole(firebaseService.getLocalSession()));
  const [isCheckingSession, setIsCheckingSession] = useState(false);
  
  // Functional circular startup loading state
  const [isAppLoading, setIsAppLoading] = useState(true);
  const [loadingProgress, setLoadingProgress] = useState(15);
  const [loadingStatusText, setLoadingStatusText] = useState('Iniciando bóveda segura...');
  const [isDataLoaded, setIsDataLoaded] = useState(false);

  const [currentTab, setCurrentTab] = useState<'vault' | 'membership' | 'receipts' | 'approvals' | 'profile'>('vault');
  const [pendingApprovalsCount, setPendingApprovalsCount] = useState<number>(() => receiptService.getPendingCount());
  const [vaultTabMode, setVaultTabMode] = useState<'items' | 'collections'>('items');
  const [selectedVaultListId, setSelectedVaultListId] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<VaultItem | null>(null);
  const [showAdminUpload, setShowAdminUpload] = useState(false);
  const [showAdminListModal, setShowAdminListModal] = useState(false);
  const [editingList, setEditingList] = useState<VaultList | null>(null);
  const [isMaintenanceActive, setIsMaintenanceActive] = useState<boolean>(() => {
    try {
      const cached = localStorage.getItem('vault_maintenance_active');
      return cached === 'true';
    } catch (e) {
      return false;
    }
  });
  const [maintenanceMessage, setMaintenanceMessage] = useState<string>(() => {
    try {
      const cached = localStorage.getItem('vault_maintenance_message');
      if (cached) return cached;
    } catch (e) {}
    return 'Estamos realizando labores de mantenimiento y optimización en la plataforma. Volveremos muy pronto.';
  });
  const [showMaintenanceModal, setShowMaintenanceModal] = useState(false);
  const [showLiveSyncModal, setShowLiveSyncModal] = useState(false);
  const [isPreviewingAsVisitor, setIsPreviewingAsVisitor] = useState(false);
  const [isLiveReloading, setIsLiveReloading] = useState(false);
  const { theme, toggleTheme, isDark } = useTheme();

  // Instant Live Reload for OTA Updates without recompiling APK
  const handleLiveReload = useCallback(() => {
    setIsLiveReloading(true);
    setIsAppLoading(true);
    setLoadingProgress(40);
    setLoadingStatusText('Sincronizando archivos en vivo (OTA Hot-Sync)...');
    liveSyncService.forceAppHotReload('Sincronización manual en vivo');
  }, []);

  // Pull-to-refresh on mobile screen top
  useEffect(() => {
    let startY = 0;
    const onTouchStart = (e: TouchEvent) => {
      if (window.scrollY <= 5) {
        startY = e.touches[0].clientY;
      }
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (startY > 0 && window.scrollY <= 5) {
        const delta = e.changedTouches[0].clientY - startY;
        if (delta > 200) {
          handleLiveReload();
        }
      }
      startY = 0;
    };
    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchend', onTouchEnd, { passive: true });
    return () => {
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchend', onTouchEnd);
    };
  }, [handleLiveReload]);

  // Helper to safely apply maintenance state based on timestamp priority
  // Prevents stale cloud data or quota errors from reverting newer local edits
  const applyMaintenanceStateIfNewer = (remote: { isMaintenance?: boolean; message?: string; updatedAt?: string }): boolean => {
    if (typeof remote.isMaintenance !== 'boolean') return false;
    try {
      const localUpdatedAtStr = localStorage.getItem('vault_maintenance_updated_at');
      const localTime = localUpdatedAtStr ? new Date(localUpdatedAtStr).getTime() : 0;
      const remoteTime = remote.updatedAt ? new Date(remote.updatedAt).getTime() : 0;

      // Only reject remote update if local has an explicitly newer change by more than 2 seconds
      if (localTime > 0 && remoteTime > 0 && (localTime - remoteTime) > 2000) {
        return false;
      }

      setIsMaintenanceActive(remote.isMaintenance);
      localStorage.setItem('vault_maintenance_active', String(remote.isMaintenance));
      if (remote.message) {
        setMaintenanceMessage(remote.message);
        localStorage.setItem('vault_maintenance_message', remote.message);
      }
      if (remote.updatedAt) {
        localStorage.setItem('vault_maintenance_updated_at', remote.updatedAt);
      }
      return true;
    } catch (err) {
      console.warn('Error applying maintenance state:', err);
      return false;
    }
  };

  // Protective guard: only admins can access 'approvals' or the general 'Publicaciones' ('items' without selected collection) section
  useEffect(() => {
    const isAdmin = currentUser?.role === 'admin';
    if (currentTab === 'approvals' && !isAdmin) {
      setCurrentTab('vault');
    }
    if (!isAdmin && vaultTabMode === 'items' && !selectedVaultListId) {
      setVaultTabMode('collections');
    }
  }, [currentTab, currentUser, vaultTabMode, selectedVaultListId]);

  // Helper to merge incoming items with existing state preserving custom user uploads
  const mergeVaultItems = useCallback((incoming: VaultItem[]) => {
    if (!Array.isArray(incoming) || incoming.length === 0) return;
    setItems((prev) => {
      const map = new Map<string, VaultItem>();
      incoming.forEach((it) => {
        if (it && it.id && !it.id.startsWith('res_00') && !it.id.startsWith('test-')) {
          map.set(it.id, it);
        }
      });
      // Keep any locally created item not yet returned from server
      prev.forEach((it) => {
        if (it && it.id && !it.id.startsWith('res_00') && !it.id.startsWith('test-') && !map.has(it.id)) {
          map.set(it.id, it);
        }
      });
      const merged = Array.from(map.values());
      supabaseService.saveLocalVaultItems(merged);
      return merged;
    });
  }, []);

  // Helper to merge lists with strict deleted lists exclusion
  const mergeVaultLists = useCallback((incoming: VaultList[], incomingDeletedIds?: string[]) => {
    if (!Array.isArray(incoming)) return;
    const deletedIds = getDeletedListIds();
    if (Array.isArray(incomingDeletedIds)) {
      incomingDeletedIds.forEach((id) => {
        if (id) deletedIds.add(String(id));
      });
      try {
        localStorage.setItem('vault_deleted_list_ids', JSON.stringify(Array.from(deletedIds)));
      } catch (e) {}
    }
    const activeIncoming = incoming.filter((l) => l && l.id && !deletedIds.has(l.id));

    setLists((prev) => {
      const map = new Map<string, VaultList>();
      // First populate with incoming active items
      activeIncoming.forEach((l) => {
        if (l && l.id && !deletedIds.has(l.id)) map.set(l.id, l);
      });
      // Merge with previous non-deleted items
      prev.forEach((l) => {
        if (l && l.id && !deletedIds.has(l.id) && !map.has(l.id)) {
          map.set(l.id, l);
        }
      });
      const merged = Array.from(map.values()).filter((l) => !deletedIds.has(l.id));
      try {
        localStorage.setItem('vault_lists_cache', JSON.stringify(merged));
      } catch (e) {}
      return merged;
    });
  }, []);

  // Check existing session and listen to Firebase auth & Firestore live items and lists
  useEffect(() => {
    const unsub = firebaseService.onAuthState((user) => {
      if (user) {
        const clean = sanitizeUserRole(user);
        setCurrentUser(clean);
        if (clean?.role !== 'admin') {
          setVaultTabMode('collections');
        }
      }
      setIsCheckingSession(false);
    });

    const handleProfileUpdated = (e: any) => {
      if (e?.detail?.profile) {
        setCurrentUser(sanitizeUserRole(e.detail.profile));
      }
    };
    window.addEventListener('vault_profile_updated', handleProfileUpdated);

    const handleReceiptsChanged = (e: any) => {
      setPendingApprovalsCount(receiptService.getPendingCount());
      const incomingReceipts = e?.detail?.receipts || receiptService.getAllReceipts();
      firebaseService.reconcileApprovedReceiptsWithUsers(incomingReceipts);
    };
    window.addEventListener('vault_receipts_changed', handleReceiptsChanged);

    // Real-time Firestore items listener
    const unsubFirestoreItems = firebaseService.onVaultItemsSnapshot((liveItems) => {
      if (liveItems && Array.isArray(liveItems) && liveItems.length > 0) {
        mergeVaultItems(liveItems);
      }
    });

    // Real-time Firestore lists listener
    const unsubFirestoreLists = firebaseService.onVaultListsSnapshot((liveLists, deletedIds) => {
      if (liveLists && Array.isArray(liveLists)) {
        mergeVaultLists(liveLists, deletedIds);
      }
    });

    // Real-time Firestore users listener
    const unsubFirestoreUsers = firebaseService.onUsersSnapshot((accountsMap) => {
      const session = firebaseService.getLocalSession();
      if (session && session.email) {
        const matched = accountsMap[session.email.toLowerCase().trim()];
        if (matched && matched.profile) {
          const clean = sanitizeUserRole(matched.profile);
          setCurrentUser(clean);
          firebaseService.saveSession(clean);
        }
      }
    });

    // Real-time Firestore receipts listener
    const unsubFirestoreReceipts = receiptService.onReceiptsSnapshot((receipts) => {
      setPendingApprovalsCount(receiptService.getPendingCount());
      firebaseService.reconcileApprovedReceiptsWithUsers(receipts);
    });

    // Real-time Firestore maintenance mode listener with timestamp arbitration
    let unsubFirestoreMaintenance = () => {};
    try {
      unsubFirestoreMaintenance = firebaseService.onMaintenanceSnapshot((maint) => {
        applyMaintenanceStateIfNewer(maint);
      });
    } catch (err) {
      console.warn('Notice: Firestore maintenance listener error:', err);
    }

    // Real-time Cloud OTA Live Sync listener
    let unsubCloudLiveSync = () => {};
    try {
      unsubCloudLiveSync = liveSyncService.listenForCloudReloads(() => {
        handleLiveReload();
      });
    } catch (err) {
      console.warn('Notice: LiveSync cloud listener error:', err);
    }

    const loadStartTime = Date.now();
    const MIN_LOADER_DURATION_MS = 1400; // Garantiza una transición circular fluida y limpia

    const finishStartup = () => {
      setLoadingProgress(100);
      setLoadingStatusText('¡Archivos cargados correctamente!');
      setIsDataLoaded(true);
      const elapsed = Date.now() - loadStartTime;
      const remaining = Math.max(0, MIN_LOADER_DURATION_MS - elapsed);
      setTimeout(() => {
        setIsAppLoading(false);
        setIsCheckingSession(false);
      }, remaining + 500);
    };

    // Safety fallback: asegura que la app nunca se quede congelada en conexiones lentas u offline
    const safetyTimer = setTimeout(() => {
      setIsCheckingSession(false);
      finishStartup();
    }, 4000);

    const loadData = async () => {
      try {
        // Fase 0: Extracción de sesión transferida y comprobación de Live OTA en standalone
        const transferred = liveSyncService.extractTransferredSession();
        if (transferred) {
          const cleanTransferred = sanitizeUserRole(transferred);
          setCurrentUser(cleanTransferred);
          firebaseService.saveSession(cleanTransferred);
        }

        // Si está en contenedor nativo local (APK/IPA compilado), intentar sincronizar con servidor en vivo
        if (liveSyncService.isLocalStandalone() && liveSyncService.isLiveSyncEnabled()) {
          setLoadingProgress(20);
          setLoadingStatusText('Buscando servidor en vivo (OTA Hot-Sync)...');
          const didLiveSync = await liveSyncService.syncToLiveServerIfAvailable(currentUser || transferred);
          if (didLiveSync) {
            return;
          }
        }

        // Fase 1: Verificación de sesión y cuentas
        setLoadingProgress(28);
        setLoadingStatusText('Verificando credenciales y acceso seguro...');

        // Sincronizar cuentas registradas con base de datos
        firebaseService.syncAllRegisteredAccountsToDatabase().catch((err) => {
          console.warn('Error syncing registered accounts to database:', err);
        });

        // Fase 2: Comprobación de recibos y pasarela
        setLoadingProgress(45);
        setLoadingStatusText('Conectando a base de datos en la nube...');
        receiptService.syncFromServer().then((syncedReceipts) => {
          setPendingApprovalsCount(receiptService.getPendingCount());
          firebaseService.reconcileApprovedReceiptsWithUsers(syncedReceipts);
        }).catch(() => {});

        // Fase 3: Descarga y sincronización de archivos y listas desde Cloud Firestore
        setLoadingProgress(65);
        setLoadingStatusText('Descargando y sincronizando archivos...');

        const [firestoreItems, firestoreLists] = await Promise.all([
          firebaseService.fetchVaultItems().catch(() => null),
          firebaseService.fetchVaultLists().catch(() => null),
        ]);

        if (firestoreItems && firestoreItems.length > 0) {
          mergeVaultItems(firestoreItems);
        }
        if (firestoreLists && firestoreLists.length > 0) {
          mergeVaultLists(firestoreLists);
        }

        // Fase 4: Indexación de archivos locales y caché
        setLoadingProgress(82);
        setLoadingStatusText('Indexando contenido de la bóveda...');

        const localItems = supabaseService.getLocalVaultItems();
        if (localItems && localItems.length > 0) {
          mergeVaultItems(localItems);
        }

        // Fase 5: Servidor dedicado (si está disponible) y listas eliminadas
        if (!isStandaloneApp() || getRemoteServerBaseUrl()) {
          try {
            const resDeleted = await safeFetchApi('/api/vault/deleted-lists', {}, 1500);
            if (resDeleted && resDeleted.ok) {
              const jsonDel = await resDeleted.json();
              if (jsonDel.deletedIds && Array.isArray(jsonDel.deletedIds)) {
                const currentDeleted = getDeletedListIds();
                jsonDel.deletedIds.forEach((id: string) => currentDeleted.add(id));
                localStorage.setItem('vault_deleted_list_ids', JSON.stringify(Array.from(currentDeleted)));
                
                try {
                  const cached = localStorage.getItem('vault_lists_cache');
                  if (cached) {
                    const parsed = JSON.parse(cached);
                    if (Array.isArray(parsed)) {
                      const filtered = parsed.filter((l: any) => !currentDeleted.has(l.id));
                      localStorage.setItem('vault_lists_cache', JSON.stringify(filtered));
                    }
                  }
                } catch (e) {}

                setLists((prev) => prev.filter((l) => !currentDeleted.has(l.id)));
              }
            }
          } catch (delErr) {
            console.warn('Notice: Server deleted lists not reachable, using local/Firestore state:', delErr);
          }

          try {
            const resItems = await safeFetchApi('/api/vault/items', {}, 2000);
            if (resItems && resItems.ok) {
              const json = await resItems.json();
              if (json.items && Array.isArray(json.items) && json.items.length > 0) {
                mergeVaultItems(json.items);
              }
            }
          } catch {}

          try {
            const resLists = await safeFetchApi('/api/vault/lists', {}, 2000);
            if (resLists && resLists.ok) {
              const jsonLists = await resLists.json();
              if (jsonLists.lists && Array.isArray(jsonLists.lists) && jsonLists.lists.length > 0) {
                mergeVaultLists(jsonLists.lists);
              }
            }
          } catch {}
        }

        // Fase 6: Estado de mantenimiento del servidor
        setLoadingProgress(94);
        setLoadingStatusText('Verificando estado del servidor y seguridad...');

        try {
          let syncedMaint = false;
          if (!isStandaloneApp() || getRemoteServerBaseUrl()) {
            const resMaint = await safeFetchApi('/api/maintenance', {}, 2500);
            if (resMaint && resMaint.ok) {
              const maintJson = await resMaint.json();
              if (typeof maintJson.isMaintenance === 'boolean') {
                syncedMaint = applyMaintenanceStateIfNewer(maintJson);
              }
            }
          }
          if (!syncedMaint) {
            const cloudMaint = await firebaseService.fetchMaintenance().catch(() => null);
            if (cloudMaint && typeof cloudMaint.isMaintenance === 'boolean') {
              applyMaintenanceStateIfNewer(cloudMaint);
            }
          }
        } catch (maintErr) {
          console.warn('Notice: Could not sync maintenance mode status on start:', maintErr);
        }
      } catch (err) {
        console.warn('Error loading initial vault data:', err);
      } finally {
        finishStartup();
      }
    };

    loadData();

    // Background poll every 30 seconds (READ-ONLY for users/lists/items so we never exhaust Firestore write quota)
    const interval = setInterval(async () => {
      try {
        firebaseService.fetchUsersFromDatabase().then((remoteAccounts) => {
          const session = firebaseService.getLocalSession();
          if (session && session.email) {
            const matched = remoteAccounts[session.email.toLowerCase().trim()];
            if (matched && matched.profile) {
              const clean = sanitizeUserRole(matched.profile);
              setCurrentUser(clean);
              firebaseService.saveSession(clean);
            }
          }
        }).catch(() => {});

        receiptService.syncFromServer().then((syncedReceipts) => {
          setPendingApprovalsCount(receiptService.getPendingCount());
          firebaseService.reconcileApprovedReceiptsWithUsers(syncedReceipts);
        }).catch(() => {});

        // Also poll maintenance state in background
        if (!isStandaloneApp() || getRemoteServerBaseUrl()) {
          safeFetchJson<{ success?: boolean; isMaintenance?: boolean; message?: string; updatedAt?: string }>('/api/maintenance', {}, 2000).then((maint) => {
            if (maint && typeof maint.isMaintenance === 'boolean') {
              applyMaintenanceStateIfNewer(maint);
            }
          }).catch(() => {});
        } else {
          firebaseService.fetchMaintenance().then((cloudMaint) => {
            if (cloudMaint && typeof cloudMaint.isMaintenance === 'boolean') {
              applyMaintenanceStateIfNewer(cloudMaint);
            }
          }).catch(() => {});
        }

        // Optional server poll if server is active
        if (!isStandaloneApp() || getRemoteServerBaseUrl()) {
          try {
            const resDel = await safeFetchApi('/api/vault/deleted-lists', {}, 1500);
            if (resDel && resDel.ok) {
              const jsonDel = await resDel.json();
              if (jsonDel.deletedIds && Array.isArray(jsonDel.deletedIds)) {
                const currentDeleted = getDeletedListIds();
                jsonDel.deletedIds.forEach((id: string) => currentDeleted.add(id));
                localStorage.setItem('vault_deleted_list_ids', JSON.stringify(Array.from(currentDeleted)));
                setLists((prev) => prev.filter((l) => !currentDeleted.has(l.id)));
              }
            }
          } catch (e) {}

          try {
            const resItems = await safeFetchApi('/api/vault/items', {}, 2000);
            if (resItems && resItems.ok) {
              const json = await resItems.json();
              if (json.items && Array.isArray(json.items)) mergeVaultItems(json.items);
            }
          } catch (e) {}

          try {
            const resLists = await safeFetchApi('/api/vault/lists', {}, 2000);
            if (resLists && resLists.ok) {
              const jsonLists = await resLists.json();
              if (jsonLists.lists && Array.isArray(jsonLists.lists)) mergeVaultLists(jsonLists.lists);
            }
          } catch (e) {}
        }

        // Also poll Firestore lists so standalone APK always stays in sync
        try {
          const fsLists = await firebaseService.fetchVaultLists();
          if (fsLists && fsLists.length > 0) mergeVaultLists(fsLists);
        } catch (e) {}
      } catch (e) {}
    }, 30000);

    return () => {
      clearTimeout(safetyTimer);
      unsub();
      window.removeEventListener('vault_profile_updated', handleProfileUpdated);
      window.removeEventListener('vault_receipts_changed', handleReceiptsChanged);
      unsubFirestoreItems();
      unsubFirestoreLists();
      unsubFirestoreUsers();
      unsubFirestoreReceipts();
      unsubFirestoreMaintenance();
      unsubCloudLiveSync();
      clearInterval(interval);
    };
  }, [mergeVaultItems, mergeVaultLists]);

  const handleLogin = (user: UserProfile) => {
    const cleanUser = sanitizeUserRole(user);
    setCurrentUser(cleanUser);
    if (cleanUser?.role === 'admin') {
      setVaultTabMode('items');
    } else {
      setVaultTabMode('collections');
      setSelectedVaultListId(null);
    }
    firebaseService.saveSession(cleanUser);
    if (cleanUser) {
      firebaseService.syncAllRegisteredAccountsToDatabase().catch(() => {});
    }
  };

  const handleLogout = async () => {
    await firebaseService.signOut();
    setCurrentUser(null);
  };

  const handleSaveMaintenance = async (newStatus: boolean, newMessage: string): Promise<boolean> => {
    const cleanMsg = newMessage.trim();
    const nowIso = new Date().toISOString();

    // 1. Immediately update local state and localStorage with timestamp so state persists reliably across APK restarts
    setIsMaintenanceActive(newStatus);
    if (cleanMsg) setMaintenanceMessage(cleanMsg);
    try {
      localStorage.setItem('vault_maintenance_active', String(newStatus));
      if (cleanMsg) localStorage.setItem('vault_maintenance_message', cleanMsg);
      localStorage.setItem('vault_maintenance_updated_at', nowIso);
    } catch {}

    // 2. Save directly to Firebase Firestore for real-time propagation across browsers/devices
    try {
      await firebaseService.saveMaintenance(newStatus, cleanMsg);
    } catch (fbErr) {
      console.warn('Firebase saveMaintenance warning:', fbErr);
    }

    // 3. Save to Express server endpoint if available
    if (!isStandaloneApp() || getRemoteServerBaseUrl()) {
      try {
        await safeFetchJson<{ success?: boolean }>('/api/maintenance', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            isMaintenance: newStatus,
            message: cleanMsg,
            adminKey: ADMIN_SECURITY_KEY,
            updatedAt: nowIso,
          }),
        }, 2500);
      } catch (err) {
        console.warn('Server API maintenance update warning:', err);
      }
    }

    // Always succeed so admin UI is updated reliably
    return true;
  };

  // Toggle Like (optimistic state + sync to Firestore and Supabase)
  const handleToggleLike = async (itemId: string) => {
    if (!currentUser) return;
    let newLikesCount = 0;
    let newLikedBy: string[] = [];

    setItems((prevItems) =>
      prevItems.map((item) => {
        if (item.id !== itemId) return item;
        const alreadyLiked = item.likedBy.includes(currentUser.uid);
        newLikedBy = alreadyLiked
          ? item.likedBy.filter((id) => id !== currentUser.uid)
          : [...item.likedBy, currentUser.uid];
        newLikesCount = alreadyLiked
          ? Math.max(0, item.likesCount - 1)
          : item.likesCount + 1;

        return {
          ...item,
          likedBy: newLikedBy,
          likesCount: newLikesCount,
        };
      })
    );

    // Update modal if open
    setSelectedItem((prev) =>
      prev && prev.id === itemId
        ? { ...prev, likedBy: newLikedBy, likesCount: newLikesCount }
        : prev
    );

    try {
      await firebaseService.updateItemLikes(itemId, newLikesCount, newLikedBy);
    } catch (e) {
      console.warn('Could not update likes in Firestore:', e);
    }
    try {
      await supabaseService.updateItemLikes(itemId, newLikesCount, newLikedBy);
    } catch (e) {
      console.warn('Could not update likes in Supabase:', e);
    }
  };

  // Add Comment (optimistic state + sync to Firestore and Supabase)
  const handleAddComment = async (itemId: string, text: string) => {
    if (!currentUser) return;
    const newComment: VaultComment = {
      id: `c_${Date.now()}`,
      userId: currentUser.uid,
      userDisplayName: currentUser.displayName,
      userRole: currentUser.role,
      userTier: currentUser.tier,
      text,
      createdAt: 'Justo ahora',
    };

    let updatedComments: VaultComment[] = [];

    setItems((prevItems) =>
      prevItems.map((item) => {
        if (item.id !== itemId) return item;
        updatedComments = [newComment, ...item.comments];
        return {
          ...item,
          comments: updatedComments,
        };
      })
    );

    // Update modal if open
    setSelectedItem((prev) =>
      prev && prev.id === itemId
        ? { ...prev, comments: updatedComments }
        : prev
    );

    try {
      await firebaseService.updateItemComments(itemId, updatedComments);
    } catch (e) {
      console.warn('Could not update comments in Firestore:', e);
    }
    try {
      await supabaseService.updateItemComments(itemId, updatedComments);
    } catch (e) {
      console.warn('Could not update comments in Supabase:', e);
    }
  };

  // Upload new vault item (Admin exclusively) with optional list assignments
  const handleUploadItem = async (
    newItemData: Omit<VaultItem, 'createdAt' | 'likesCount' | 'likedBy' | 'comments'> & { id?: string },
    targetListIds: string[] = []
  ) => {
    const newItemId = newItemData.id || `vault-res-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const newItem: VaultItem = {
      ...newItemData,
      id: newItemId,
      createdAt: new Date().toISOString().split('T')[0],
      likesCount: 1,
      likedBy: currentUser ? [currentUser.uid] : ['admin_master_astro'],
      comments: [],
      listIds: targetListIds.length > 0 ? targetListIds : newItemData.listIds,
    };

    let itemToPersist = { ...newItem };

    // 1. Persist to Central Server API (if server is available)
    try {
      const res = await safeFetchApi('/api/vault/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newItem),
      }, 2500);
      if (res && res.ok) {
        const data = await res.json();
        if (data && data.item) {
          itemToPersist = { ...itemToPersist, ...data.item };
        }
      }
    } catch (e) {
      console.warn('Central API upload notice:', e);
    }

    // 2. Persist to Firestore
    try {
      await firebaseService.saveVaultItemToFirestore(itemToPersist);
    } catch (e) {
      console.warn('Firestore direct upload error:', e);
    }

    // 3. Persist to Supabase
    try {
      await supabaseService.insertVaultItem(itemToPersist);
    } catch (e) {
      console.warn('Supabase upload error:', e);
    }

    // 4. Update UI State & Local Backup
    setItems((prev) => {
      const updated = [itemToPersist, ...prev.filter((i) => i.id !== itemToPersist.id)];
      supabaseService.saveLocalVaultItems(updated);
      return updated;
    });

    // 5. If assigned to target lists, update those lists
    if (targetListIds.length > 0) {
      targetListIds.forEach(async (listId) => {
        const listToUpdate = lists.find((l) => l.id === listId);
        if (listToUpdate && !listToUpdate.itemIds.includes(itemToPersist.id)) {
          const updatedItemIds = [...listToUpdate.itemIds, itemToPersist.id];
          const updatedList = { ...listToUpdate, itemIds: updatedItemIds };
          
          setLists((prev) =>
            prev.map((l) => (l.id === listId ? updatedList : l))
          );

          try {
            await safeFetchApi('/api/vault/lists', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(updatedList),
            }, 2000);
            await firebaseService.saveVaultListToFirestore(updatedList);
          } catch (e) {
            console.warn('Error updating list with new item:', e);
          }
        }
      });
    }
  };

  // Update vault item (e.g., after re-uploading file)
  const handleUpdateItem = (updatedItem: VaultItem) => {
    setItems((prev) => {
      const updated = prev.map((i) => (i.id === updatedItem.id ? updatedItem : i));
      supabaseService.saveLocalVaultItems(updated);
      return updated;
    });
    setSelectedItem(updatedItem);
  };

  // Delete vault item (Admin exclusively)
  const handleDeleteItem = async (itemId: string) => {
    setItems((prev) => {
      const updated = prev.filter((item) => item.id !== itemId);
      supabaseService.saveLocalVaultItems(updated);
      return updated;
    });
    if (selectedItem?.id === itemId) {
      setSelectedItem(null);
    }

    // Also update lists containing this item
    setLists((prevLists) =>
      prevLists.map((l) => ({
        ...l,
        itemIds: l.itemIds.filter((id) => id !== itemId),
      }))
    );

    // 1. Delete on Central Server (if available)
    try {
      await safeFetchApi(`/api/vault/items/${itemId}`, { method: 'DELETE' }, 2000);
    } catch (e) {}

    // 2. Delete on Firestore
    try {
      await firebaseService.deleteVaultItemFromFirestore(itemId);
    } catch (e) {}

    // 3. Delete on Supabase
    try {
      await supabaseService.deleteVaultItem(itemId);
    } catch (e) {}
  };

  // Create or Update Vault List (Admin)
  const handleSaveList = async (listData: Partial<VaultList>) => {
    const listId = listData.id || `list_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    unmarkDeletedListId(listId);

    const fullList: VaultList = {
      id: listId,
      name: listData.name?.trim() || 'Nueva Colección',
      description: listData.description?.trim() || '',
      icon: listData.icon || 'folder',
      color: listData.color || '#0066FF',
      itemIds: Array.isArray(listData.itemIds) ? listData.itemIds : [],
      createdBy: currentUser?.displayName || 'Administrador',
      createdAt: listData.createdAt || new Date().toISOString().split('T')[0],
    };

    // Optimistic UI update
    let nextListsSnapshot: VaultList[] = [];
    setLists((prev) => {
      const exists = prev.some((l) => l.id === fullList.id);
      const next = exists
        ? prev.map((l) => (l.id === fullList.id ? fullList : l))
        : [...prev, fullList];
      nextListsSnapshot = next;
      try {
        localStorage.setItem('vault_lists_cache', JSON.stringify(next));
      } catch (e) {}
      return next;
    });

    // 1. Server API (if available)
    try {
      await safeFetchApi('/api/vault/lists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fullList),
      }, 2000);
    } catch (e) {
      console.warn('Notice: Central server list update:', e);
    }

    // 2. Firestore
    try {
      await firebaseService.saveVaultListToFirestore(
        fullList,
        nextListsSnapshot.length > 0 ? nextListsSnapshot : undefined,
        Array.from(getDeletedListIds())
      );
    } catch (e) {
      console.warn('Error saving list to Firestore:', e);
    }

    setShowAdminListModal(false);
    setEditingList(null);
  };

  // Delete Vault List (Admin)
  const handleDeleteList = async (listId: string) => {
    if (!listId) return;

    // 1. Mark in persistent client-side deleted blacklist
    addDeletedListId(listId);

    // 2. Optimistic UI
    let remainingSnapshot: VaultList[] = [];
    setLists((prev) => {
      const next = prev.filter((l) => l.id !== listId);
      remainingSnapshot = next;
      try {
        localStorage.setItem('vault_lists_cache', JSON.stringify(next));
      } catch (e) {}
      return next;
    });

    // 3. Server API (if available)
    try {
      await safeFetchApi(`/api/vault/lists/${encodeURIComponent(listId)}`, { method: 'DELETE' }, 2000);
    } catch (e) {
      console.warn('Notice: Server list delete:', e);
    }

    // 4. Firestore
    try {
      await firebaseService.deleteVaultListFromFirestore(
        listId,
        remainingSnapshot,
        Array.from(getDeletedListIds())
      );
    } catch (e) {
      console.warn('Error deleting list from Firestore:', e);
    }

    setShowAdminListModal(false);
    setEditingList(null);
  };

  // Toggle single item in list (Admin quick action)
  const handleToggleItemInList = async (listId: string, itemId: string) => {
    let updatedList: VaultList | null = null;
    let nextListsSnapshot: VaultList[] = [];

    setLists((prev) => {
      const next = prev.map((l) => {
        if (l.id !== listId) return l;
        const exists = l.itemIds.includes(itemId);
        const newItemIds = exists
          ? l.itemIds.filter((id) => id !== itemId)
          : [...l.itemIds, itemId];
        updatedList = { ...l, itemIds: newItemIds };
        return updatedList;
      });
      nextListsSnapshot = next;
      try {
        localStorage.setItem('vault_lists_cache', JSON.stringify(next));
      } catch (e) {}
      return next;
    });

    if (updatedList) {
      try {
        await safeFetchApi(`/api/vault/lists/${listId}/toggle-item`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ itemId }),
        }, 2000);
        await firebaseService.saveVaultListToFirestore(
          updatedList,
          nextListsSnapshot.length > 0 ? nextListsSnapshot : undefined,
          Array.from(getDeletedListIds())
        );
      } catch (e) {
        console.warn('Error toggling item in list:', e);
      }
    }
  };

  // Sync selectedItem if item list updates
  const activeDetailItem = selectedItem
    ? items.find((i) => i.id === selectedItem.id) || selectedItem
    : null;

  // Priority 0: Pantalla de carga circular funcional al iniciar la app
  // Carga y sincroniza de forma confiable todos los archivos, colecciones, base de datos y sesión
  if (isAppLoading) {
    return (
      <CircularStartupLoader
        progress={loadingProgress}
        statusText={loadingStatusText}
        itemCount={items.length}
        isReady={isDataLoaded}
        onAnimationComplete={() => setIsAppLoading(false)}
      />
    );
  }

  // Priority 1: When maintenance mode is active, block everything for non-admins (or when admin explicitly tests visitor mode)
  if (isMaintenanceActive && ((!currentUser || currentUser.role !== 'admin') || isPreviewingAsVisitor)) {
    return (
      <div className="relative w-full h-full min-h-full">
        {isPreviewingAsVisitor && (
          <div className="fixed top-0 inset-x-0 z-[100000] bg-amber-500 text-black px-4 py-2.5 text-xs font-black flex items-center justify-between shadow-2xl border-b-2 border-amber-600">
            <div className="flex items-center gap-2 min-w-0">
              <Wrench className="w-4 h-4 shrink-0" />
              <span className="truncate">
                VISTA PREVIA DE VISITANTE (ADMINISTRADOR) &bull; Así se muestra la app a los usuarios
              </span>
            </div>
            <button
              onClick={() => setIsPreviewingAsVisitor(false)}
              className="bg-black text-white hover:bg-slate-900 px-3 py-1 rounded-xl text-xs font-bold transition-all cursor-pointer shrink-0 shadow-sm ml-2"
            >
              Volver a Administrador
            </button>
          </div>
        )}
        <MaintenanceScreen
          onAdminLogin={(admin) => {
            setIsPreviewingAsVisitor(false);
            handleLogin(admin);
          }}
          customMessage={maintenanceMessage}
        />
      </div>
    );
  }

  // Priority 2: Unauthenticated view -> Mandatory AuthScreen (100% pantalla completa Edge-to-Edge)
  if (!currentUser) {
    return (
      <div className="w-full h-full min-h-full flex flex-col p-0 m-0 overflow-hidden bg-black text-white select-none">
        <AuthScreen onLogin={handleLogin} />
      </div>
    );
  }

  const isStandalone = isStandaloneApp();

  return (
    <div
      className={`h-full min-h-full w-full flex-1 flex flex-col font-sans overflow-hidden select-none relative ${
        isDark
          ? 'bg-[#060709] text-white selection:bg-[#0066FF] selection:text-white'
          : 'bg-[#F8FAFC] text-[#0F172A] selection:bg-[#0066FF] selection:text-white'
      }`}
    >
      {/* Ambient background glows for high-end luxury dark aesthetic */}
      {isDark && (
        <div className="pointer-events-none absolute inset-0 overflow-hidden z-0">
          <div className="absolute -top-40 left-1/4 w-96 h-96 bg-[#0066FF]/10 rounded-full blur-3xl opacity-60" />
          <div className="absolute top-1/3 -right-24 w-80 h-80 bg-emerald-500/5 rounded-full blur-3xl opacity-40" />
          <div className="absolute -bottom-24 left-1/3 w-96 h-96 bg-indigo-600/8 rounded-full blur-3xl opacity-50" />
        </div>
      )}

      {/* Top Header Bar for Private Server */}
      <header
        className={`shrink-0 z-40 px-3 sm:px-6 lg:px-8 py-2.5 sm:py-3 pt-[max(0.6rem,env(safe-area-inset-top))] pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] border-b backdrop-blur-2xl transition-all relative ${
          isDark
            ? 'border-white/[0.08] bg-[#07080B]/90 shadow-[0_8px_32px_rgba(0,0,0,0.85)] ring-1 ring-inset ring-white/[0.04]'
            : 'border-slate-200/90 bg-white/95 shadow-[0_4px_24px_rgba(0,0,0,0.06)]'
        }`}
      >
        <div className="w-full flex items-center justify-between gap-3 sm:gap-6 relative z-10">
          {/* Brand & Logo */}
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
            <motion.div 
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => {
                setCurrentTab('vault');
                if (currentUser.role !== 'admin') {
                  setVaultTabMode('collections');
                }
              }}
              className="relative w-9 h-9 sm:w-10 sm:h-10 rounded-2xl bg-gradient-to-br from-[#0066FF] via-[#0055D4] to-blue-900 flex items-center justify-center shadow-lg shadow-[#0066FF]/35 text-white shrink-0 cursor-pointer border border-blue-400/30 ring-1 ring-inset ring-white/20"
            >
              <ShieldCheck className="w-5 h-5 text-white" />
              <div className="absolute inset-0 rounded-2xl bg-white/15 opacity-0 hover:opacity-100 transition-opacity" />
            </motion.div>

            {isSupabaseConfigured && (
              <span className="hidden lg:inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[8.5px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                <Database className="w-2.5 h-2.5" /> SUPABASE
              </span>
            )}
          </div>

          {/* Right Controls: User info with Avatar, Theme & Logout */}
          <div className="flex items-center gap-2 sm:gap-2.5 shrink-0 ml-auto">
            {/* Admin Live Sync (OTA Updates) Button */}
            {currentUser.role === 'admin' && (
              <motion.button
                whileHover={{ scale: 1.04 }}
                whileTap={{ scale: 0.96 }}
                onClick={() => setShowLiveSyncModal(true)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-[11px] sm:text-xs font-bold transition-all cursor-pointer bg-blue-500/10 border-blue-500/30 text-blue-400 hover:bg-blue-500/20 shadow-xs"
                title="Configurar Actualizaciones en Vivo (OTA Live Updates)"
              >
                <Radio className="w-3.5 h-3.5 shrink-0 text-blue-400 animate-pulse" />
                <span className="hidden sm:inline">OTA:</span>
                <span className="font-black text-blue-400">
                  {liveSyncService.isCurrentlyOnLiveServer() ? 'LIVE' : 'ACTIVO'}
                </span>
              </motion.button>
            )}

            {/* Admin Maintenance Control Button */}
            {currentUser.role === 'admin' && (
              <motion.button
                whileHover={{ scale: 1.04 }}
                whileTap={{ scale: 0.96 }}
                onClick={() => setShowMaintenanceModal(true)}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-[11px] sm:text-xs font-bold transition-all cursor-pointer ${
                  isMaintenanceActive
                    ? 'bg-amber-500/20 border-amber-500/40 text-amber-500 dark:text-amber-400 hover:bg-amber-500/30 shadow-sm'
                    : 'bg-black/5 dark:bg-white/5 border-slate-200 dark:border-white/10 text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                }`}
                title="Configurar Modo Mantenimiento"
              >
                <Wrench className="w-3.5 h-3.5 shrink-0" />
                <span className="hidden sm:inline">Mantenimiento:</span>
                <span className={isMaintenanceActive ? 'font-black text-amber-500 dark:text-amber-400' : 'font-semibold text-slate-400'}>
                  {isMaintenanceActive ? 'ON' : 'OFF'}
                </span>
              </motion.button>
            )}


            {/* Botón de Sincronización en Tiempo Real */}
            <motion.button
              id="header-live-reload-btn"
              onClick={handleLiveReload}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              title="Sincronizar cambios en tiempo real"
              className={`p-2 rounded-xl border transition-all flex items-center gap-1.5 cursor-pointer ${
                isLiveReloading
                  ? 'bg-emerald-500/20 border-emerald-500 text-emerald-400'
                  : isDark
                  ? 'border-white/[0.08] bg-zinc-900/60 hover:bg-zinc-800 text-zinc-300 hover:text-white hover:border-emerald-500/40'
                  : 'border-slate-200 bg-white hover:bg-slate-100 text-slate-700 hover:text-black hover:border-emerald-500'
              }`}
            >
              <RefreshCw className={`w-4 h-4 text-emerald-400 ${isLiveReloading ? 'animate-spin' : ''}`} />
              <span className="hidden xl:inline text-[11px] font-bold text-emerald-400">Sincronizar</span>
            </motion.button>

            {/* Theme Toggle */}
            <motion.button
              id="theme-toggle-btn"
              onClick={toggleTheme}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className={`p-2 rounded-xl border transition-colors cursor-pointer ${
                isDark
                  ? 'border-[#1E1E24] hover:bg-[#1A1A22] text-[#8E8E93] hover:text-white'
                  : 'border-[#E2E8F0] hover:bg-slate-100 text-[#64748B] hover:text-black'
              }`}
              title="Cambiar Modo Claro / Oscuro"
            >
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={theme}
                  initial={{ rotate: -90, opacity: 0 }}
                  animate={{ rotate: 0, opacity: 1 }}
                  exit={{ rotate: 90, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  {theme === 'dark' ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-slate-700" />}
                </motion.div>
              </AnimatePresence>
            </motion.button>

            {/* Logout Button */}
            <motion.button
              id="logout-btn"
              onClick={handleLogout}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className={`p-2 rounded-xl border transition-colors cursor-pointer ${
                isDark
                  ? 'border-[#1E1E24] hover:bg-red-500/15 hover:border-red-500/30 text-[#8E8E93] hover:text-red-400'
                  : 'border-[#E2E8F0] hover:bg-red-50 text-[#64748B] hover:text-red-600'
              }`}
              title="Cerrar Sesión"
            >
              <LogOut className="w-4 h-4" />
            </motion.button>
          </div>
        </div>
      </header>

      {/* Top Banner when Maintenance is Active (Exclusive for Admin) */}
      {isMaintenanceActive && currentUser?.role === 'admin' && (
        <div className="shrink-0 z-30 px-3 sm:px-6 py-2 bg-gradient-to-r from-amber-500/20 via-amber-500/15 to-amber-500/20 border-b border-amber-500/35 text-amber-500 dark:text-amber-400 flex flex-wrap items-center justify-between gap-2 shadow-sm">
          <div className="flex items-center gap-2 text-xs font-bold min-w-0">
            <span className="relative flex h-2.5 w-2.5 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-500" />
            </span>
            <span className="truncate">
              <strong className="uppercase">Modo Mantenimiento Activo:</strong> Plataforma bloqueada para visitantes y miembros regulares.
            </span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0 ml-auto">
            <button
              type="button"
              onClick={() => setIsPreviewingAsVisitor(true)}
              className="px-2.5 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-[11px] font-bold text-amber-500 dark:text-amber-300 transition-colors cursor-pointer flex items-center gap-1 shadow-xs"
              title="Ver cómo ven la pantalla de bloqueo los usuarios"
            >
              <Eye className="w-3 h-3" />
              <span>Probar como Visitante</span>
            </button>
            <button
              type="button"
              onClick={() => setShowMaintenanceModal(true)}
              className="px-2.5 py-1 rounded-lg bg-black/10 dark:bg-white/10 hover:bg-black/20 dark:hover:bg-white/20 border border-amber-500/30 text-[11px] font-bold text-amber-600 dark:text-amber-300 transition-colors cursor-pointer flex items-center gap-1 shadow-xs"
            >
              <Wrench className="w-3 h-3" />
              <span>Configurar</span>
            </button>
            <button
              type="button"
              onClick={async () => {
                await handleSaveMaintenance(false, maintenanceMessage);
              }}
              className="px-2.5 py-1 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-[11px] font-bold text-emerald-600 dark:text-emerald-400 transition-colors cursor-pointer flex items-center gap-1 shadow-xs"
              title="Desactivar mantenimiento y permitir acceso libre"
            >
              <CheckCircle2 className="w-3 h-3" />
              <span>Desactivar</span>
            </button>
          </div>
        </div>
      )}

      {/* Main Content Area: Always 100% full-bleed edge-to-edge */}
      <main className="flex-1 w-full p-0 m-0 overflow-hidden flex flex-col min-h-0">
        <div className={`w-full h-full flex-1 rounded-none border-0 shadow-none overflow-hidden flex flex-col min-h-0 relative ${
          isDark ? 'bg-black text-white' : 'bg-[#F8FAFC] text-[#0F172A]'
        }`}>
          <AnimatePresence mode="wait">
            {currentTab === 'vault' && (
              <motion.div
                key="vault"
                initial={{ opacity: 0, y: 8, scale: 0.995 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.995 }}
                transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                className="w-full h-full flex flex-col min-h-0"
              >
                <VaultScreen
                  items={items}
                  lists={lists}
                  currentUser={currentUser}
                  onSelectItem={(item) => setSelectedItem(item)}
                  onOpenAdminUpload={() => setShowAdminUpload(true)}
                  onOpenAdminCreateList={() => {
                    setEditingList(null);
                    setShowAdminListModal(true);
                  }}
                  onOpenAdminEditList={(list) => {
                    setEditingList(list);
                    setShowAdminListModal(true);
                  }}
                  onDeleteList={handleDeleteList}
                  onDeleteItem={handleDeleteItem}
                  onNavigateToReceipts={() => setCurrentTab('receipts')}
                  onNavigateToMembership={() => setCurrentTab('membership')}
                  activeTabMode={vaultTabMode}
                  onTabModeChange={setVaultTabMode}
                  selectedListId={selectedVaultListId}
                  onSelectedListChange={setSelectedVaultListId}
                />
              </motion.div>
            )}

            {currentTab === 'membership' && (
              <motion.div
                key="membership"
                initial={{ opacity: 0, y: 8, scale: 0.995 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.995 }}
                transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                className="w-full h-full flex flex-col min-h-0"
              >
                <MembershipScreen
                  currentUser={currentUser}
                  onUpdateUser={(updated) => setCurrentUser(updated)}
                  onNavigateToVault={() => setCurrentTab('vault')}
                  onNavigateToReceipts={() => setCurrentTab('receipts')}
                />
              </motion.div>
            )}

            {currentTab === 'receipts' && (
              <motion.div
                key="receipts"
                initial={{ opacity: 0, y: 8, scale: 0.995 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.995 }}
                transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                className="w-full h-full flex flex-col min-h-0"
              >
                <ReceiptsScreen
                  currentUser={currentUser}
                  onUpdateUser={(updated) => setCurrentUser(updated)}
                  onNavigateToMembership={() => setCurrentTab('membership')}
                  onNavigateToVault={() => setCurrentTab('vault')}
                  onNavigateToApprovals={() => setCurrentTab('approvals')}
                />
              </motion.div>
            )}

            {currentTab === 'approvals' && currentUser?.role === 'admin' && (
              <motion.div
                key="approvals"
                initial={{ opacity: 0, y: 8, scale: 0.995 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.995 }}
                transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                className="w-full h-full flex flex-col min-h-0"
              >
                <AdminApprovalsScreen
                  currentUser={currentUser}
                  onUpdateCurrentUser={(updated) => setCurrentUser(updated)}
                  onNavigateToVault={() => setCurrentTab('vault')}
                  onNavigateToMembership={() => setCurrentTab('membership')}
                  onNavigateToReceipts={() => setCurrentTab('receipts')}
                />
              </motion.div>
            )}

            {currentTab === 'profile' && (
              <motion.div
                key="profile"
                initial={{ opacity: 0, y: 8, scale: 0.995 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.995 }}
                transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                className="w-full flex-1 h-full flex flex-col min-h-0"
              >
                <ProfileScreen
                  currentUser={currentUser}
                  onLogout={handleLogout}
                  onUpdateUser={(updated) => setCurrentUser(updated)}
                  items={items}
                  onSelectItem={(item) => setSelectedItem(item)}
                  onNavigateToMembership={() => setCurrentTab('membership')}
                  onNavigateToReceipts={() => setCurrentTab('receipts')}
                  onNavigateToVault={() => {
                    setCurrentTab('vault');
                    setVaultTabMode(currentUser?.role === 'admin' ? 'items' : 'collections');
                    setSelectedVaultListId(null);
                  }}
                  isMaintenanceActive={isMaintenanceActive}
                  onOpenMaintenanceModal={() => setShowMaintenanceModal(true)}
                  onOpenLiveSyncModal={() => setShowLiveSyncModal(true)}
                  onPreviewAsVisitor={() => setIsPreviewingAsVisitor(true)}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>

      {/* GLOBAL BOTTOM HOME BAR (Luxury Floating Dock) */}
      <nav 
        id="global-bottom-home-bar"
        aria-label="Barra de Navegación Inferior"
        className="shrink-0 z-40 px-3 sm:px-6 py-2 sm:py-2.5 flex justify-center pb-[max(0.75rem,env(safe-area-inset-bottom))] pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] pointer-events-none"
      >
        <div className={`pointer-events-auto flex items-center justify-around sm:justify-center gap-1 sm:gap-2 px-3 sm:px-4 py-1.5 rounded-full border shadow-2xl backdrop-blur-2xl transition-all ${
          isDark 
            ? 'bg-zinc-950/90 border-white/[0.12] ring-1 ring-inset ring-white/[0.05] shadow-[0_16px_40px_rgba(0,0,0,0.85)]' 
            : 'bg-white/95 border-slate-200/90 ring-1 ring-inset ring-slate-100 shadow-[0_12px_32px_rgba(0,0,0,0.12)]'
        }`}>
          {/* Publicaciones (SOLO ICONO, EXCLUSIVO PARA ADMINISTRACIÓN) */}
          {currentUser?.role === 'admin' && (() => {
            const isActive = currentTab === 'vault' && vaultTabMode === 'items' && !selectedVaultListId;
            return (
              <motion.button
                id="home-bar-tab-publicaciones"
                type="button"
                title={`Publicaciones (${items.length})`}
                aria-label="Publicaciones"
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.88 }}
                onClick={() => {
                  setCurrentTab('vault');
                  setVaultTabMode('items');
                  setSelectedVaultListId(null);
                }}
                className={`relative flex items-center justify-center w-10 h-10 rounded-full cursor-pointer select-none outline-none focus:outline-none transition-colors ${
                  isActive ? 'text-white' : isDark ? 'text-zinc-400 hover:text-white' : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                {isActive && (
                  <motion.div
                    layoutId="active-bottom-nav-pill"
                    className="absolute inset-0 rounded-full bg-[#0066FF] shadow-[0_0_20px_rgba(0,102,255,0.55)]"
                    transition={{ type: "spring", stiffness: 450, damping: 32 }}
                  />
                )}
                <FolderClosed className="relative z-10 w-4.5 h-4.5 sm:w-5 sm:h-5 shrink-0" />
              </motion.button>
            );
          })()}

          {/* Colecciones (SOLO ICONO) */}
          {(() => {
            const isActive = currentTab === 'vault' && (vaultTabMode === 'collections' || selectedVaultListId !== null);
            return (
              <motion.button
                id="home-bar-tab-colecciones"
                type="button"
                title={`Colecciones (${lists.length})`}
                aria-label="Colecciones"
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.88 }}
                onClick={() => {
                  setCurrentTab('vault');
                  setVaultTabMode('collections');
                  setSelectedVaultListId(null);
                }}
                className={`relative flex items-center justify-center w-10 h-10 rounded-full cursor-pointer select-none outline-none focus:outline-none transition-colors ${
                  isActive ? 'text-white' : isDark ? 'text-zinc-400 hover:text-white' : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                {isActive && (
                  <motion.div
                    layoutId="active-bottom-nav-pill"
                    className="absolute inset-0 rounded-full bg-[#0066FF] shadow-[0_0_20px_rgba(0,102,255,0.55)]"
                    transition={{ type: "spring", stiffness: 450, damping: 32 }}
                  />
                )}
                <Layers className="relative z-10 w-4.5 h-4.5 sm:w-5 sm:h-5 shrink-0" />
              </motion.button>
            );
          })()}

          {/* Separador vertical sutil */}
          <div className={`w-px h-5 mx-0.5 shrink-0 ${isDark ? 'bg-[#1E1E24]' : 'bg-slate-300'}`} />

          {/* Membresía VIP (SOLO ICONO) */}
          {(() => {
            const isActive = currentTab === 'membership';
            return (
              <motion.button
                id="home-bar-tab-membresia"
                type="button"
                title="Membresía VIP"
                aria-label="Membresía VIP"
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.88 }}
                onClick={() => setCurrentTab('membership')}
                className={`relative flex items-center justify-center w-10 h-10 rounded-full cursor-pointer select-none outline-none focus:outline-none transition-colors ${
                  isActive ? 'text-white' : isDark ? 'text-zinc-400 hover:text-white' : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                {isActive && (
                  <motion.div
                    layoutId="active-bottom-nav-pill"
                    className="absolute inset-0 rounded-full bg-[#0066FF] shadow-[0_0_20px_rgba(0,102,255,0.55)]"
                    transition={{ type: "spring", stiffness: 450, damping: 32 }}
                  />
                )}
                <Crown className={`relative z-10 w-4.5 h-4.5 sm:w-5 sm:h-5 shrink-0 ${isActive ? 'text-amber-200' : 'text-amber-400'}`} />
              </motion.button>
            );
          })()}

          {/* Apartado de Comprobación (SOLO ICONO) */}
          {(() => {
            const isActive = currentTab === 'receipts';
            return (
              <motion.button
                id="home-bar-tab-comprobantes"
                type="button"
                title="Comprobación de Pago"
                aria-label="Comprobación de Pago"
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.88 }}
                onClick={() => setCurrentTab('receipts')}
                className={`relative flex items-center justify-center w-10 h-10 rounded-full cursor-pointer select-none outline-none focus:outline-none transition-colors ${
                  isActive ? 'text-white' : isDark ? 'text-zinc-400 hover:text-white' : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                {isActive && (
                  <motion.div
                    layoutId="active-bottom-nav-pill"
                    className="absolute inset-0 rounded-full bg-[#0066FF] shadow-[0_0_20px_rgba(0,102,255,0.55)]"
                    transition={{ type: "spring", stiffness: 450, damping: 32 }}
                  />
                )}
                <div className="relative z-10 flex items-center justify-center">
                  <FileText className="w-4.5 h-4.5 sm:w-5 sm:h-5 shrink-0" />
                  {!isActive && (
                    <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]" />
                  )}
                </div>
              </motion.button>
            );
          })()}

          {/* Apartado de Aprobación en Home Bar (SOLO ICONO, SOLO ADMINISTRADORES) */}
          {currentUser?.role === 'admin' && (() => {
            const isActive = currentTab === 'approvals';
            return (
              <>
                <div className={`w-px h-5 mx-0.5 shrink-0 ${isDark ? 'bg-[#1E1E24]' : 'bg-slate-300'}`} />
                <motion.button
                  id="home-bar-tab-aprobaciones"
                  type="button"
                  title={`Aprobación de Membresías (${pendingApprovalsCount} pendientes)`}
                  aria-label="Aprobación de Membresías"
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.88 }}
                  onClick={() => setCurrentTab('approvals')}
                  className={`relative flex items-center justify-center w-10 h-10 rounded-full cursor-pointer select-none outline-none focus:outline-none transition-colors ${
                    isActive ? 'text-white' : isDark ? 'text-zinc-400 hover:text-white' : 'text-slate-500 hover:text-slate-900'
                  }`}
                >
                  {isActive && (
                    <motion.div
                      layoutId="active-bottom-nav-pill"
                      className="absolute inset-0 rounded-full bg-[#0066FF] shadow-[0_0_20px_rgba(0,102,255,0.55)]"
                      transition={{ type: "spring", stiffness: 450, damping: 32 }}
                    />
                  )}
                  <div className="relative z-10 flex items-center justify-center">
                    <ShieldCheck className="w-4.5 h-4.5 sm:w-5 sm:h-5 shrink-0" />
                    {pendingApprovalsCount > 0 && (
                      <span className="absolute -top-1.5 -right-2 px-1 py-0.2 min-w-[14px] text-[9px] font-black rounded-full bg-amber-400 text-black border border-black flex items-center justify-center shadow-xs">
                        {pendingApprovalsCount}
                      </span>
                    )}
                  </div>
                </motion.button>
              </>
            );
          })()}

          {/* Separador vertical sutil */}
          <div className={`w-px h-5 mx-0.5 shrink-0 ${isDark ? 'bg-[#1E1E24]' : 'bg-slate-300'}`} />

          {/* Perfil del Usuario (FOTO DE PERFIL EN TIEMPO REAL) */}
          {(() => {
            const isActive = currentTab === 'profile';
            return (
              <motion.button
                id="home-bar-tab-ajustes"
                type="button"
                title={currentUser?.displayName ? `Perfil (${currentUser.displayName})` : 'Mi Perfil'}
                aria-label={currentUser?.displayName ? `Perfil de ${currentUser.displayName}` : 'Mi Perfil'}
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.88 }}
                onClick={() => setCurrentTab('profile')}
                className={`relative flex items-center justify-center w-10 h-10 rounded-full cursor-pointer select-none outline-none focus:outline-none focus:ring-0 active:outline-none border-none ring-0 transition-colors ${
                  isActive ? 'text-white' : isDark ? 'text-zinc-400 hover:text-white' : 'text-slate-500 hover:text-slate-900'
                }`}
                style={{ WebkitTapHighlightColor: 'transparent' }}
              >
                {isActive && (
                  <motion.div
                    layoutId="active-bottom-nav-pill"
                    className="absolute inset-0 rounded-full bg-[#0066FF] shadow-[0_0_20px_rgba(0,102,255,0.55)]"
                    transition={{ type: "spring", stiffness: 450, damping: 32 }}
                  />
                )}
                <div className="relative z-10 flex items-center justify-center">
                  {currentUser?.avatarUrl ? (
                    <img
                      src={currentUser.avatarUrl}
                      alt={currentUser.displayName || 'Foto de perfil'}
                      className="w-6 h-6 sm:w-6.5 sm:h-6.5 rounded-full object-cover shrink-0 select-none pointer-events-none ring-0 border-0 outline-none"
                    />
                  ) : currentUser?.displayName ? (
                    <div
                      className={`w-6 h-6 sm:w-6.5 sm:h-6.5 rounded-full flex items-center justify-center font-black text-[10px] sm:text-xs text-white shrink-0 select-none ring-0 border-0 outline-none ${
                        isActive
                          ? 'bg-white/20'
                          : 'bg-gradient-to-br from-[#0066FF] to-blue-700'
                      }`}
                    >
                      {currentUser.displayName.charAt(0).toUpperCase()}
                    </div>
                  ) : (
                    <User className="w-4.5 h-4.5 sm:w-5 sm:h-5 shrink-0" />
                  )}
                </div>
              </motion.button>
            );
          })()}
        </div>
      </nav>

      {/* Resource Detail & Modal */}
      <AnimatePresence>
        {activeDetailItem && (
          <VaultDetailModal
            item={activeDetailItem}
            currentUser={currentUser}
            onClose={() => setSelectedItem(null)}
            onToggleLike={handleToggleLike}
            onAddComment={handleAddComment}
            onDeleteItem={handleDeleteItem}
            onUpdateItem={handleUpdateItem}
            lists={lists}
            onToggleItemInList={handleToggleItemInList}
          />
        )}
      </AnimatePresence>

      {/* Admin Exclusive Upload Modal */}
      <AnimatePresence>
        {showAdminUpload && (
          <AdminUploadModal
            isOpen={showAdminUpload}
            onClose={() => setShowAdminUpload(false)}
            onUpload={handleUploadItem}
            currentUser={currentUser}
            lists={lists}
          />
        )}
      </AnimatePresence>

      {/* Admin List Creator / Manager Modal */}
      <AnimatePresence>
        {showAdminListModal && (
          <AdminListModal
            isOpen={showAdminListModal}
            onClose={() => {
              setShowAdminListModal(false);
              setEditingList(null);
            }}
            onSave={handleSaveList}
            onDelete={handleDeleteList}
            initialList={editingList}
            items={items}
          />
        )}
      </AnimatePresence>

      {/* Admin Maintenance Mode Configuration Modal */}
      <AnimatePresence>
        {showMaintenanceModal && (
          <AdminMaintenanceModal
            isOpen={showMaintenanceModal}
            onClose={() => setShowMaintenanceModal(false)}
            isMaintenance={isMaintenanceActive}
            maintenanceMessage={maintenanceMessage}
            onSave={handleSaveMaintenance}
          />
        )}
      </AnimatePresence>

      {/* Admin OTA Live Sync Modal */}
      <AnimatePresence>
        {showLiveSyncModal && (
          <AdminLiveSyncModal
            isOpen={showLiveSyncModal}
            onClose={() => setShowLiveSyncModal(false)}
            currentUser={currentUser}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AppContent />
    </ThemeProvider>
  );
}

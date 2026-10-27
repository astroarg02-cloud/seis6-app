import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { UserProfile, VaultItem, PaymentReceipt } from '../../types';
import { 
  ShieldCheck, LogOut, Key, User, Calendar, Database, 
  CheckCircle2, XCircle, Moon, Sun, Palette, Shield, Sparkles, AlertCircle,
  Edit3, Camera, Phone, Heart, FileText, Crown, Users, Check,
  ChevronRight, ArrowRight, ExternalLink, RefreshCw, Upload, Image as ImageIcon,
  Instagram, Settings, Copy, Wrench, Eye, Radio
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { VerifiedBadge } from '../VerifiedBadge';
import { useTheme } from '../../context/ThemeContext';
import { isAuthorizedAdminKey, ADMIN_SECURITY_KEY } from '../../data/initialVaultData';
import { firebaseService, getStoredRegisteredAccounts } from '../../services/firebaseService';
import { receiptService } from '../../services/receiptService';
import { exportFlutterNativeProjectZip } from '../../services/zipExporter';

// Galería de avatares predeterminados para elegir
const AVATAR_PRESETS = [
  { id: 'admin-astro', url: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80', label: 'Astro' },
  { id: 'vip-alex', url: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80', label: 'Alex' },
  { id: 'user-neo', url: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80', label: 'Neo' },
  { id: 'user-luna', url: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150&auto=format&fit=crop&q=80', label: 'Luna' },
  { id: 'user-cyber', url: 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=150&auto=format&fit=crop&q=80', label: 'Cyber' },
  { id: 'user-maya', url: 'https://images.unsplash.com/photo-1580489944761-15a19d654956?w=150&auto=format&fit=crop&q=80', label: 'Maya' },
  { id: 'bot-blue', url: 'https://api.dicebear.com/7.x/bottts/svg?seed=BlueBot', label: 'Bot Blue' },
  { id: 'bot-gold', url: 'https://api.dicebear.com/7.x/bottts/svg?seed=GoldenVIP', label: 'Bot VIP' },
];

interface ProfileScreenProps {
  currentUser: UserProfile;
  onLogout: () => void;
  onUpdateUser?: (updated: UserProfile) => void;
  items?: VaultItem[];
  onSelectItem?: (item: VaultItem) => void;
  onNavigateToMembership?: () => void;
  onNavigateToReceipts?: () => void;
  onNavigateToVault?: () => void;
  isMaintenanceActive?: boolean;
  onOpenMaintenanceModal?: () => void;
  onOpenLiveSyncModal?: () => void;
  onPreviewAsVisitor?: () => void;
}

export const ProfileScreen: React.FC<ProfileScreenProps> = ({ 
  currentUser, 
  onLogout, 
  onUpdateUser,
  items = [],
  onSelectItem,
  onNavigateToMembership,
  onNavigateToReceipts,
  onNavigateToVault,
  isMaintenanceActive = false,
  onOpenMaintenanceModal,
  onOpenLiveSyncModal,
  onPreviewAsVisitor,
}) => {
  const { setTheme, isDark } = useTheme();
  const hasPurchasedMembership = Boolean(
    currentUser.membershipStatus === 'active' &&
    currentUser.membershipPlan
  );
  
  // Tabs internas del perfil (Por defecto 'settings' para ver Ajustes y Sistema de inmediato)
  const [activeProfileTab, setActiveProfileTab] = useState<'settings' | 'info' | 'activity'>('settings');

  // Modal de Edición de Perfil
  const [showEditModal, setShowEditModal] = useState(false);
  const [editDisplayName, setEditDisplayName] = useState(currentUser.displayName || '');
  const [editBio, setEditBio] = useState(currentUser.bio || '');
  const [editPhone, setEditPhone] = useState(currentUser.phone || '');
  const [editInstagram, setEditInstagram] = useState(currentUser.instagram || '');
  const [editCustomStatus, setEditCustomStatus] = useState(currentUser.customStatus || '');
  const [editAvatarUrl, setEditAvatarUrl] = useState(currentUser.avatarUrl || '');
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [saveToast, setSaveToast] = useState<string | null>(null);

  // Comprobantes del usuario
  const [userReceipts, setUserReceipts] = useState<PaymentReceipt[]>(() => {
    return receiptService.getReceiptsByUser(currentUser.uid);
  });

  const [copiedUid, setCopiedUid] = useState(false);

  const handleCopyUserId = async () => {
    try {
      if (currentUser?.uid) {
        await navigator.clipboard.writeText(currentUser.uid);
        setCopiedUid(true);
        setTimeout(() => setCopiedUid(false), 2000);
      }
    } catch {}
  };

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Sincronizar campos de edición si cambia el usuario activo
  useEffect(() => {
    if (!showEditModal) {
      setEditDisplayName(currentUser.displayName || '');
      setEditBio(currentUser.bio || '');
      setEditPhone(currentUser.phone || '');
      setEditInstagram(currentUser.instagram || '');
      setEditCustomStatus(currentUser.customStatus || '');
      setEditAvatarUrl(currentUser.avatarUrl || '');
    }
  }, [currentUser, showEditModal]);

  // Sincronizar comprobantes cuando cambien
  useEffect(() => {
    const handleReceiptsUpdate = () => {
      setUserReceipts(receiptService.getReceiptsByUser(currentUser.uid, currentUser.email));
    };
    window.addEventListener('vault_receipts_changed', handleReceiptsUpdate);
    window.addEventListener('vault_profile_updated', handleReceiptsUpdate);
    return () => {
      window.removeEventListener('vault_receipts_changed', handleReceiptsUpdate);
      window.removeEventListener('vault_profile_updated', handleReceiptsUpdate);
    };
  }, [currentUser.uid, currentUser.email]);

  // Publicaciones favoritas (guardadas por este usuario)
  const userFavoriteItems = items.filter((item) => 
    Array.isArray(item.likedBy) && item.likedBy.includes(currentUser.uid)
  );

  // Manejar apertura del modal de edición
  const handleOpenEdit = () => {
    setEditDisplayName(currentUser.displayName || '');
    setEditBio(currentUser.bio || '');
    setEditPhone(currentUser.phone || '');
    setEditInstagram(currentUser.instagram || '');
    setEditCustomStatus(currentUser.customStatus || '');
    setEditAvatarUrl(currentUser.avatarUrl || '');
    setShowEditModal(true);
  };

  // Comprimir imagen de avatar para garantizar guardado instantáneo en localStorage, Servidor y Firestore
  const compressAvatarDataUrl = (rawDataUrl: string): Promise<string> => {
    return new Promise((resolve) => {
      try {
        const img = new Image();
        img.onload = () => {
          try {
            const maxDim = 320;
            let width = img.width || 320;
            let height = img.height || 320;
            if (width > maxDim || height > maxDim) {
              if (width > height) {
                height = Math.round((height * maxDim) / width);
                width = maxDim;
              } else {
                width = Math.round((width * maxDim) / height);
                height = maxDim;
              }
            }
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
              resolve(rawDataUrl);
              return;
            }
            ctx.drawImage(img, 0, 0, width, height);
            const compressed = canvas.toDataURL('image/jpeg', 0.84);
            resolve(compressed);
          } catch {
            resolve(rawDataUrl);
          }
        };
        img.onerror = () => resolve(rawDataUrl);
        img.src = rawDataUrl;
      } catch {
        resolve(rawDataUrl);
      }
    });
  };

  // Subir imagen personalizada para avatar
  const handleAvatarFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async () => {
      if (typeof reader.result === 'string') {
        const optimized = await compressAvatarDataUrl(reader.result);
        setEditAvatarUrl(optimized);
      }
    };
    reader.readAsDataURL(file);
  };

  // Guardar cambios en el perfil individual
  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = editDisplayName.trim() || currentUser.displayName || 'Usuario';

    setIsSavingProfile(true);
    const nowIso = new Date().toISOString();

    let finalAvatar = editAvatarUrl || currentUser.avatarUrl;
    if (finalAvatar && finalAvatar.startsWith('data:image/') && finalAvatar.length > 80000) {
      finalAvatar = await compressAvatarDataUrl(finalAvatar);
    }

    const updatedProfile: UserProfile = {
      ...currentUser,
      displayName: cleanName,
      avatarUrl: finalAvatar,
      bio: editBio.trim(),
      phone: editPhone.trim(),
      instagram: editInstagram.trim().replace(/^@/, ''),
      customStatus: editCustomStatus.trim(),
      updatedAt: nowIso,
    };

    try {
      if (onUpdateUser) {
        onUpdateUser(updatedProfile);
      }
      await firebaseService.updateUserProfile(updatedProfile);
      setShowEditModal(false);
      setSaveToast('¡Tu perfil ha sido actualizado y guardado exitosamente!');
      try {
        confetti({ particleCount: 60, spread: 60, origin: { y: 0.6 } });
      } catch {}
      setTimeout(() => setSaveToast(null), 4000);
    } catch (err) {
      console.error('Error saving profile:', err);
      setShowEditModal(false);
      setSaveToast('¡Perfil guardado localmente!');
      setTimeout(() => setSaveToast(null), 3500);
    } finally {
      setIsSavingProfile(false);
    }
  };

  // Cambio rápido de avatar con 1 toque
  const handleQuickSelectAvatar = async (url: string) => {
    const nowIso = new Date().toISOString();
    const updatedProfile: UserProfile = {
      ...currentUser,
      avatarUrl: url,
      updatedAt: nowIso,
    };
    setEditAvatarUrl(url);
    try {
      if (onUpdateUser) {
        onUpdateUser(updatedProfile);
      }
      await firebaseService.updateUserProfile(updatedProfile);
      setSaveToast('¡Foto de perfil actualizada exitosamente!');
      try {
        confetti({ particleCount: 30, spread: 50, origin: { y: 0.5 } });
      } catch {}
      setTimeout(() => setSaveToast(null), 3000);
    } catch (err) {
      console.error('Error changing avatar:', err);
    }
  };

  return (
    <div
      className={`w-full flex-1 h-full min-h-0 flex flex-col overflow-y-auto overscroll-contain custom-scrollbar p-3 sm:p-5 lg:p-6 pb-20 sm:pb-24 ${
        isDark ? 'bg-black text-white' : 'bg-[#F8FAFC] text-[#0F172A]'
      }`}
    >
      <div className="w-full max-w-4xl mx-auto space-y-3 sm:space-y-4">
      {/* Toast Notification */}
      <AnimatePresence>
        {saveToast && (
          <motion.div
            initial={{ opacity: 0, y: -20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.95 }}
            className="fixed top-14 left-1/2 -translate-x-1/2 z-50 bg-[#0066FF] text-white px-4 py-2 rounded-2xl shadow-xl flex items-center gap-2 text-xs font-semibold"
          >
            <CheckCircle2 className="w-4 h-4 text-white" />
            <span>{saveToast}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header del Apartado */}
      <div className="flex items-center justify-between pb-1">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-[#0066FF]/15 flex items-center justify-center text-[#0066FF] shrink-0">
            <Settings className="w-4.5 h-4.5" />
          </div>
          <div>
            <div className="text-[10px] font-extrabold tracking-[0.2em] text-[#0066FF] uppercase">
              APARTADO OFICIAL
            </div>
            <h2 className={`text-base sm:text-lg font-black tracking-tight ${isDark ? 'text-white' : 'text-[#0F172A]'}`}>
              Ajustes y Sistema
            </h2>
          </div>
        </div>

        <motion.button
          onClick={handleOpenEdit}
          whileHover={{ scale: 1.04 }}
          whileTap={{ scale: 0.96 }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#0066FF] hover:bg-[#0052FF] text-white text-xs font-bold shadow-md shadow-[#0066FF]/25 cursor-pointer transition-all"
        >
          <Edit3 className="w-3.5 h-3.5" />
          <span>Editar Perfil</span>
        </motion.button>
      </div>

      {/* TARJETA PRINCIPAL: FOTO DE PERFIL CON NOMBRE Y AJUSTES */}
      <div className={`p-4 sm:p-5 rounded-2xl border transition-all ${
        isDark 
          ? 'bg-[#0A0A0C] border-[#1E1E24] shadow-lg shadow-black/50' 
          : 'bg-white border-[#E2E8F0] shadow-sm'
      }`}>
        <div className="flex flex-col sm:flex-row items-center sm:items-start gap-4">
          {/* Foto de Perfil con Botón de Edición */}
          <div className="relative shrink-0">
            {currentUser.avatarUrl ? (
              <img
                src={currentUser.avatarUrl}
                alt={currentUser.displayName}
                className="w-20 h-20 sm:w-22 sm:h-22 rounded-2xl object-cover border-2 border-[#0066FF] shadow-lg shadow-[#0066FF]/25"
              />
            ) : (
              <div className="w-20 h-20 sm:w-22 sm:h-22 rounded-2xl bg-gradient-to-br from-[#0066FF] to-blue-700 flex items-center justify-center text-3xl font-black text-white shadow-lg shadow-[#0066FF]/25">
                {currentUser.displayName ? currentUser.displayName.charAt(0).toUpperCase() : 'U'}
              </div>
            )}
            
            <button
              onClick={handleOpenEdit}
              title="Cambiar foto de perfil"
              className="absolute -bottom-1.5 -right-1.5 bg-[#0066FF] hover:bg-[#0052FF] text-white p-1.5 rounded-full shadow-lg border-2 border-black cursor-pointer transition-transform hover:scale-110"
            >
              <Camera className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Nombre, Email, Badges y Opciones de Perfil */}
          <div className="flex-1 text-center sm:text-left min-w-0 space-y-1">
            <div className="flex items-center justify-center sm:justify-start gap-2 flex-wrap">
              <h3 className={`text-base sm:text-lg font-black truncate ${isDark ? 'text-white' : 'text-[#0F172A]'}`}>
                {currentUser.displayName}
              </h3>
              {currentUser.role === 'admin' ? (
                <VerifiedBadge className="w-4 h-4 text-[#0066FF] shrink-0" />
              ) : hasPurchasedMembership ? (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-500 border border-emerald-500/30">
                  VIP
                </span>
              ) : null}
            </div>

            <p className={`text-xs ${isDark ? 'text-[#8E8E93]' : 'text-[#64748B]'}`}>
              {currentUser.email}
            </p>

            {currentUser.customStatus && (
              <p className="text-xs italic font-medium text-[#0066FF]">
                "{currentUser.customStatus}"
              </p>
            )}

            {currentUser.bio && (
              <p className={`text-xs line-clamp-2 pt-0.5 ${isDark ? 'text-zinc-300' : 'text-slate-600'}`}>
                {currentUser.bio}
              </p>
            )}

            {(currentUser.phone || currentUser.instagram) && (
              <div className="flex items-center justify-center sm:justify-start gap-2.5 flex-wrap pt-1 text-[11px]">
                {currentUser.phone && (
                  <span className="inline-flex items-center gap-1 font-semibold text-emerald-500">
                    <Phone className="w-3 h-3" />
                    <span>{currentUser.phone}</span>
                  </span>
                )}
                {currentUser.instagram && (
                  <span className="inline-flex items-center gap-1 font-semibold text-pink-500">
                    <Instagram className="w-3 h-3" />
                    <span>@{currentUser.instagram.replace(/^@/, '')}</span>
                  </span>
                )}
              </div>
            )}

            {/* Badges de Rol y Membresía (Solo aparece lo de la membresía si la tienen comprada) */}
            {(currentUser.role === 'admin' || hasPurchasedMembership) && (
              <div className="flex items-center justify-center sm:justify-start gap-1.5 flex-wrap pt-1.5">
                {currentUser.role === 'admin' && (
                  <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full uppercase tracking-wider bg-[#0066FF]/15 text-[#0066FF]">
                    ADMINISTRADOR
                  </span>
                )}

                {hasPurchasedMembership && (
                  <>
                    <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full uppercase tracking-wider bg-emerald-500/15 text-emerald-500">
                      MIEMBRO VIP
                    </span>
                    <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full uppercase tracking-wider bg-amber-500/15 text-amber-500 border border-amber-500/30 flex items-center gap-1">
                      <Crown className="w-3 h-3" />
                      {currentUser.membershipPlan === 'annual' ? 'Plan Anual' : 'Plan Mensual'}
                      {typeof currentUser.lastPaymentAmount === 'number' && currentUser.lastPaymentAmount > 0 ? ` ($${currentUser.lastPaymentAmount} USD)` : ''}
                    </span>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Carrusel de Selección Rápida de Foto de Perfil */}
        <div className={`mt-3.5 pt-3 border-t ${isDark ? 'border-[#1E1E24]' : 'border-slate-100'}`}>
          <div className="flex items-center justify-between mb-2">
            <span className={`text-[11px] font-bold flex items-center gap-1.5 ${isDark ? 'text-zinc-300' : 'text-slate-700'}`}>
              <Camera className="w-3.5 h-3.5 text-[#0066FF]" />
              <span>Seleccionar Foto de Perfil:</span>
            </span>
            <button
              onClick={handleOpenEdit}
              className="text-[11px] font-bold text-[#0066FF] hover:underline flex items-center gap-1 cursor-pointer"
            >
              <Edit3 className="w-3 h-3" />
              <span>Subir personalizada</span>
            </button>
          </div>

          <div className="flex items-center gap-2 overflow-x-auto pb-1 custom-scrollbar">
            {AVATAR_PRESETS.map((preset) => {
              const isSelected = currentUser.avatarUrl === preset.url;
              return (
                <button
                  key={preset.id}
                  onClick={() => handleQuickSelectAvatar(preset.url)}
                  title={`Elegir ${preset.label}`}
                  className={`relative shrink-0 rounded-xl overflow-hidden p-0.5 border-2 transition-all cursor-pointer ${
                    isSelected ? 'border-[#0066FF] scale-105 shadow-md shadow-[#0066FF]/30' : 'border-transparent hover:border-slate-400'
                  }`}
                >
                  <img src={preset.url} alt={preset.label} className="w-9 h-9 sm:w-10 sm:h-10 rounded-lg object-cover" />
                  {isSelected && (
                    <div className="absolute inset-0 bg-[#0066FF]/25 flex items-center justify-center">
                      <Check className="w-3.5 h-3.5 text-white stroke-[3]" />
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Tabs de Navegación del Apartado */}
      <div className={`flex items-center gap-1 p-1 rounded-2xl border ${
        isDark ? 'bg-[#0A0A0C] border-[#1E1E24]' : 'bg-slate-100 border-slate-200'
      }`}>
        <button
          id="tab-ajustes-sistema"
          onClick={() => setActiveProfileTab('settings')}
          className={`flex-1 py-1.5 px-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer outline-none ${
            activeProfileTab === 'settings'
              ? 'bg-[#0066FF] text-white shadow-md shadow-[#0066FF]/25'
              : isDark ? 'text-zinc-400 hover:text-white' : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          <Shield className="w-3.5 h-3.5" />
          <span>Ajustes & Sistema</span>
        </button>

        <button
          id="tab-ajustes-datos"
          onClick={() => setActiveProfileTab('info')}
          className={`flex-1 py-1.5 px-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer outline-none ${
            activeProfileTab === 'info'
              ? 'bg-[#0066FF] text-white shadow-md shadow-[#0066FF]/25'
              : isDark ? 'text-zinc-400 hover:text-white' : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          <User className="w-3.5 h-3.5" />
          <span>Datos de Perfil</span>
        </button>

        <button
          id="tab-ajustes-actividades"
          onClick={() => setActiveProfileTab('activity')}
          className={`flex-1 py-1.5 px-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer outline-none ${
            activeProfileTab === 'activity'
              ? 'bg-[#0066FF] text-white shadow-md shadow-[#0066FF]/25'
              : isDark ? 'text-zinc-400 hover:text-white' : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          <Heart className="w-3.5 h-3.5" />
          <span>Actividades ({userFavoriteItems.length})</span>
        </button>
      </div>

      {/* CONTENIDO DE CADA SECCIÓN */}

      {/* SECCIÓN 1: INFORMACIÓN DETALLADA */}
      {activeProfileTab === 'info' && (
        <div className="space-y-3">
          {/* Tarjeta de Membresía Actual (Solo se muestra si tiene la membresía comprada) */}
          {hasPurchasedMembership && (
            <div className={`p-4 rounded-2xl border transition-colors ${
              isDark ? 'bg-[#0A0A0C] border-[#1E1E24]' : 'bg-white border-[#E2E8F0] shadow-sm'
            }`}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-amber-500/15 flex items-center justify-center text-amber-500">
                    <Crown className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className={`text-xs font-bold ${isDark ? 'text-white' : 'text-[#0F172A]'}`}>
                      Estado de la Membresía
                    </h4>
                    <p className={`text-[10px] ${isDark ? 'text-[#8E8E93]' : 'text-[#64748B]'}`}>
                      Suscripción Activa ({currentUser.membershipPlan === 'annual' ? 'Plan Anual' : 'Plan Mensual'})
                    </p>
                  </div>
                </div>

                {onNavigateToMembership && (
                  <button
                    onClick={onNavigateToMembership}
                    className="px-3 py-1.5 rounded-xl bg-[#0066FF] hover:bg-[#0052FF] text-white text-xs font-bold flex items-center gap-1 cursor-pointer transition-all"
                  >
                    <span>Ver Plan</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {currentUser.membershipExpiresAt && (() => {
                const expireDate = new Date(currentUser.membershipExpiresAt);
                const startDate = currentUser.subscribedAt ? new Date(currentUser.subscribedAt) : new Date();
                const daysLeft = Math.max(0, Math.ceil((expireDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
                return (
                  <div className={`p-2.5 rounded-xl space-y-1.5 text-xs ${
                    isDark ? 'bg-[#121216]' : 'bg-slate-50'
                  }`}>
                    <div className="flex items-center justify-between">
                      <span className={isDark ? 'text-[#8E8E93]' : 'text-[#64748B]'}>Fecha exacta de inicio:</span>
                      <span className={`font-mono font-bold ${isDark ? 'text-white' : 'text-[#0F172A]'}`}>
                        {startDate.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })} ({startDate.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false })} hs)
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className={isDark ? 'text-[#8E8E93]' : 'text-[#64748B]'}>Fecha exacta de vencimiento:</span>
                      <span className="font-mono font-bold text-emerald-400">
                        {expireDate.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })} ({expireDate.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false })} hs)
                      </span>
                    </div>
                    <div className="flex items-center justify-between pt-1 border-t border-white/5">
                      <span className={isDark ? 'text-[#8E8E93]' : 'text-[#64748B]'}>Vigencia restante:</span>
                      <span className="text-[#0066FF] font-mono font-bold">
                        {daysLeft} {daysLeft === 1 ? 'día restante' : 'días restantes'}
                      </span>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          {/* Tarjeta de Biografía & Datos de Contacto */}
          <div className={`p-4 rounded-2xl border transition-colors space-y-3 ${
            isDark ? 'bg-[#0A0A0C] border-[#1E1E24]' : 'bg-white border-[#E2E8F0] shadow-sm'
          }`}>
            <div className="flex items-center justify-between">
              <h4 className={`text-xs font-bold flex items-center gap-2 ${isDark ? 'text-white' : 'text-[#0F172A]'}`}>
                <User className="w-3.5 h-3.5 text-[#0066FF]" />
                <span>Sobre mí & Contacto</span>
              </h4>
              <button
                onClick={handleOpenEdit}
                className="text-[11px] font-bold text-[#0066FF] hover:underline cursor-pointer flex items-center gap-1"
              >
                <Edit3 className="w-3 h-3" /> Editar
              </button>
            </div>

            <div className="space-y-2 text-xs">
              <div className={`p-2.5 rounded-xl ${isDark ? 'bg-[#121216]' : 'bg-slate-50'}`}>
                <div className={`text-[10px] font-semibold mb-0.5 ${isDark ? 'text-[#8E8E93]' : 'text-[#64748B]'}`}>
                  Biografía Personal:
                </div>
                <div className={isDark ? 'text-white' : 'text-[#0F172A]'}>
                  {currentUser.bio || 'Sin biografía añadida todavía. Haz clic en "Editar Perfil" para presentarte ante la comunidad.'}
                </div>
              </div>

              <div className={`p-2.5 rounded-xl flex items-center justify-between ${isDark ? 'bg-[#121216]' : 'bg-slate-50'}`}>
                <span className={isDark ? 'text-[#8E8E93]' : 'text-[#64748B]'}>WhatsApp / Teléfono:</span>
                <span className="font-semibold text-emerald-500">
                  {currentUser.phone || 'No configurado'}
                </span>
              </div>

              {currentUser.instagram && (
                <div className={`p-2.5 rounded-xl flex items-center justify-between ${isDark ? 'bg-[#121216]' : 'bg-slate-50'}`}>
                  <span className={isDark ? 'text-[#8E8E93]' : 'text-[#64748B]'}>Instagram:</span>
                  <span className="font-semibold text-pink-500 flex items-center gap-1">
                    <Instagram className="w-3 h-3" />
                    @{currentUser.instagram.replace(/^@/, '')}
                  </span>
                </div>
              )}

              <div className={`p-2.5 rounded-xl flex items-center justify-between ${isDark ? 'bg-[#121216]' : 'bg-slate-50'}`}>
                <span className={isDark ? 'text-[#8E8E93]' : 'text-[#64748B]'}>Fecha de Registro:</span>
                <span className={isDark ? 'text-white' : 'text-[#0F172A]'}>
                  {currentUser.joinedAt}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SECCIÓN 2: ACTIVIDAD PERSONAL (Favoritos y Comprobantes) */}
      {activeProfileTab === 'activity' && (
        <div className="space-y-4">
          {/* Publicaciones que este usuario ha marcado como Me Gusta */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className={`text-xs font-bold flex items-center gap-1.5 ${isDark ? 'text-white' : 'text-[#0F172A]'}`}>
                <Heart className="w-3.5 h-3.5 text-red-500" />
                <span>Mis Publicaciones Favoritas ({userFavoriteItems.length})</span>
              </h4>
              {onNavigateToVault && (
                <button
                  onClick={onNavigateToVault}
                  className="text-[11px] font-bold text-[#0066FF] hover:underline cursor-pointer"
                >
                  Explorar Bóveda
                </button>
              )}
            </div>

            {userFavoriteItems.length === 0 ? (
              <div className={`p-6 rounded-2xl border text-center ${
                isDark ? 'bg-[#0A0A0C] border-[#1E1E24]' : 'bg-white border-[#E2E8F0]'
              }`}>
                <Heart className="w-8 h-8 text-slate-400 mx-auto mb-2 opacity-50" />
                <p className={`text-xs font-medium ${isDark ? 'text-[#8E8E93]' : 'text-[#64748B]'}`}>
                  Aún no has guardado ninguna publicación en tus favoritos.
                </p>
                {onNavigateToVault && (
                  <button
                    onClick={onNavigateToVault}
                    className="mt-3 px-3.5 py-1.5 rounded-xl bg-[#0066FF] text-white text-xs font-bold cursor-pointer"
                  >
                    Ver Colecciones
                  </button>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {userFavoriteItems.map((item) => (
                  <motion.div
                    key={item.id}
                    whileHover={{ scale: 1.01 }}
                    onClick={() => onSelectItem && onSelectItem(item)}
                    className={`p-2.5 rounded-xl border flex items-center gap-3 cursor-pointer transition-all ${
                      isDark ? 'bg-[#0A0A0C] border-[#1E1E24] hover:border-[#0066FF]/50' : 'bg-white border-[#E2E8F0] hover:border-[#0066FF]'
                    }`}
                  >
                    <img
                      src={item.coverImage}
                      alt={item.title}
                      className="w-12 h-12 rounded-lg object-cover shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <h5 className={`text-xs font-bold truncate ${isDark ? 'text-white' : 'text-[#0F172A]'}`}>
                        {item.title}
                      </h5>
                      <span className="text-[10px] text-emerald-500 font-semibold block uppercase">
                        {item.category}
                      </span>
                    </div>
                    <Heart className="w-4 h-4 text-red-500 fill-red-500 shrink-0" />
                  </motion.div>
                ))}
              </div>
            )}
          </div>

          {/* Mis Comprobantes Subidos */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className={`text-xs font-bold flex items-center gap-1.5 ${isDark ? 'text-white' : 'text-[#0F172A]'}`}>
                <FileText className="w-3.5 h-3.5 text-emerald-500" />
                <span>Mis Comprobantes de Pago ({userReceipts.length})</span>
              </h4>
              {onNavigateToReceipts && (
                <button
                  onClick={onNavigateToReceipts}
                  className="text-[11px] font-bold text-emerald-500 hover:underline cursor-pointer flex items-center gap-1"
                >
                  <Upload className="w-3 h-3" /> Subir Comprobante
                </button>
              )}
            </div>

            {userReceipts.length === 0 ? (
              <div className={`p-6 rounded-2xl border text-center ${
                isDark ? 'bg-[#0A0A0C] border-[#1E1E24]' : 'bg-white border-[#E2E8F0]'
              }`}>
                <FileText className="w-8 h-8 text-slate-400 mx-auto mb-2 opacity-50" />
                <p className={`text-xs font-medium ${isDark ? 'text-[#8E8E93]' : 'text-[#64748B]'}`}>
                  No has subido ningún comprobante con esta cuenta todavía.
                </p>
                {onNavigateToReceipts && (
                  <button
                    onClick={onNavigateToReceipts}
                    className="mt-3 px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold cursor-pointer"
                  >
                    Subir mi primer comprobante
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                {userReceipts.map((rec) => (
                  <div
                    key={rec.id}
                    className={`p-3 rounded-xl border flex items-center justify-between gap-3 text-xs ${
                      isDark ? 'bg-[#0A0A0C] border-[#1E1E24]' : 'bg-white border-[#E2E8F0]'
                    }`}
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className={`font-bold ${isDark ? 'text-white' : 'text-[#0F172A]'}`}>
                          {rec.plan === 'annual' ? 'Plan Anual' : 'Plan Mensual'} ({rec.amount}$ {rec.currency})
                        </span>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          rec.status === 'approved'
                            ? 'bg-emerald-500/15 text-emerald-500 border border-emerald-500/30'
                            : rec.status === 'rejected'
                            ? 'bg-red-500/15 text-red-500 border border-red-500/30'
                            : 'bg-amber-500/15 text-amber-500 border border-amber-500/30'
                        }`}>
                          {rec.status === 'approved' ? '✓ Aprobado' : rec.status === 'rejected' ? '✗ Rechazado' : '⏳ En Revisión'}
                        </span>
                      </div>
                      <p className={`text-[10px] mt-0.5 ${isDark ? 'text-[#8E8E93]' : 'text-[#64748B]'}`}>
                        Ref: {rec.referenceCode} • {new Date(rec.createdAt).toLocaleDateString()}
                      </p>
                    </div>

                    {onNavigateToReceipts && (
                      <button
                        onClick={onNavigateToReceipts}
                        className="px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-[11px] font-bold cursor-pointer"
                      >
                        Ver
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* SECCIÓN 3: AJUSTES & SISTEMA */}
      {activeProfileTab === 'settings' && (
        <div className="space-y-4">
          {/* App Theme Switcher Section (Dark / Light) */}
          <div
            className={`p-4 rounded-2xl border transition-colors ${
              isDark ? 'bg-[#0A0A0C] border-[#1E1E24]' : 'bg-white border-[#E2E8F0] shadow-sm'
            }`}
          >
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-[#0066FF]/15 flex items-center justify-center text-[#0066FF]">
                  <Palette className="w-4 h-4" />
                </div>
                <div>
                  <span className={`text-xs font-bold ${isDark ? 'text-white' : 'text-[#0F172A]'}`}>
                    Tema de Visualización
                  </span>
                  <p className={`text-[10px] ${isDark ? 'text-[#8E8E93]' : 'text-[#64748B]'}`}>
                    {isDark ? 'Modo Oscuro (#000000)' : 'Modo Claro'}
                  </p>
                </div>
              </div>

              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#0066FF]/15 text-[#0066FF]">
                {isDark ? 'Oscuro' : 'Claro'}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <motion.button
                id="theme-dark-select-btn"
                onClick={() => setTheme('dark')}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.97 }}
                className={`py-2 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 border cursor-pointer ${
                  isDark
                    ? 'bg-[#0066FF] text-white border-[#0066FF] shadow-md shadow-[#0066FF]/30'
                    : 'bg-[#F1F5F9] text-[#64748B] border-[#E2E8F0] hover:text-[#0F172A]'
                }`}
              >
                <Moon className="w-3.5 h-3.5" />
                <span>Modo Oscuro</span>
              </motion.button>

              <motion.button
                id="theme-light-select-btn"
                onClick={() => setTheme('light')}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.97 }}
                className={`py-2 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 border cursor-pointer ${
                  !isDark
                    ? 'bg-[#0066FF] text-white border-[#0066FF] shadow-md shadow-[#0066FF]/30'
                    : 'bg-[#121216] text-[#8E8E93] border-[#1E1E24] hover:text-white'
                }`}
              >
                <Sun className="w-3.5 h-3.5" />
                <span>Modo Claro</span>
              </motion.button>
            </div>
          </div>

          {/* Panel de Control de Modo Mantenimiento (Exclusivo Administrador) */}
          {currentUser.role === 'admin' && onOpenMaintenanceModal && (
            <div
              className={`p-4 rounded-2xl border transition-colors ${
                isDark ? 'bg-[#0A0A0C] border-[#1E1E24]' : 'bg-white border-[#E2E8F0] shadow-sm'
              }`}
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${
                    isMaintenanceActive
                      ? 'bg-amber-500/15 text-amber-500 border border-amber-500/30'
                      : 'bg-emerald-500/15 text-emerald-500 border border-emerald-500/30'
                  }`}>
                    <Wrench className="w-4 h-4" />
                  </div>
                  <div>
                    <span className={`text-xs font-bold ${isDark ? 'text-white' : 'text-[#0F172A]'}`}>
                      Control de Modo Mantenimiento
                    </span>
                    <p className={`text-[10px] ${isDark ? 'text-[#8E8E93]' : 'text-[#64748B]'}`}>
                      {isMaintenanceActive
                        ? 'Acceso bloqueado: Solo administradores con Key pueden ingresar'
                        : 'Acceso normal: Plataforma libre para todos los miembros'}
                    </p>
                  </div>
                </div>

                <span className={`text-[10px] font-extrabold px-2.5 py-0.5 rounded-full border ${
                  isMaintenanceActive
                    ? 'bg-amber-500/15 text-amber-500 border-amber-500/30'
                    : 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30'
                }`}>
                  {isMaintenanceActive ? 'ACTIVO (ON)' : 'INACTIVO (OFF)'}
                </span>
              </div>

              <div className="flex flex-col sm:flex-row items-center gap-2">
                <motion.button
                  type="button"
                  onClick={onOpenMaintenanceModal}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  className={`w-full sm:flex-1 py-2.5 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer shadow-sm ${
                    isMaintenanceActive
                      ? 'bg-gradient-to-r from-amber-500 to-amber-600 text-white shadow-amber-500/20'
                      : 'bg-slate-100 hover:bg-slate-200 dark:bg-[#15151D] dark:hover:bg-[#1E1E28] text-slate-800 dark:text-white border border-slate-200 dark:border-[#252533]'
                  }`}
                >
                  <Wrench className="w-3.5 h-3.5" />
                  <span>Configurar Modo Mantenimiento</span>
                </motion.button>
                {isMaintenanceActive && onPreviewAsVisitor && (
                  <motion.button
                    type="button"
                    onClick={onPreviewAsVisitor}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    className="w-full sm:w-auto py-2.5 px-3.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 text-amber-500 dark:text-amber-400 shrink-0 shadow-xs"
                    title="Ver pantalla de bloqueo de mantenimiento"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>Probar Vista Visitante</span>
                  </motion.button>
                )}
              </div>
            </div>
          )}

          {/* Panel de Actualizaciones en Vivo (OTA Live Updates) */}
          {currentUser.role === 'admin' && onOpenLiveSyncModal && (
            <div
              className={`p-4 rounded-2xl border transition-colors ${
                isDark ? 'bg-[#0A0A0C] border-[#1E1E24]' : 'bg-white border-[#E2E8F0] shadow-sm'
              }`}
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl flex items-center justify-center bg-blue-500/15 text-blue-500 border border-blue-500/30">
                    <Radio className="w-4 h-4 animate-pulse" />
                  </div>
                  <div>
                    <span className={`text-xs font-bold ${isDark ? 'text-white' : 'text-[#0F172A]'}`}>
                      Actualizaciones en Vivo (OTA Móvil)
                    </span>
                    <p className={`text-[10px] ${isDark ? 'text-[#8E8E93]' : 'text-[#64748B]'}`}>
                      Sincroniza modificaciones en la app compilada (APK/IPA) al instante
                    </p>
                  </div>
                </div>

                <span className="text-[10px] font-extrabold px-2.5 py-0.5 rounded-full border bg-blue-500/15 text-blue-400 border-blue-500/30 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-ping" />
                  <span>HOT-SYNC</span>
                </span>
              </div>

              <motion.button
                type="button"
                onClick={onOpenLiveSyncModal}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className="w-full py-2.5 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer shadow-sm bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-blue-500/20"
              >
                <Radio className="w-3.5 h-3.5" />
                <span>Gestionar Servidor y Forzar Sincronización</span>
              </motion.button>
            </div>
          )}

          {/* Role-Based Permissions Matrix */}
          <div className="space-y-2">
            <div className={`text-[11px] font-bold tracking-wider uppercase ${isDark ? 'text-[#8E8E93]' : 'text-[#64748B]'}`}>
              Matriz de Permisos (RBAC)
            </div>
            <div
              className={`border rounded-xl p-3 text-xs space-y-2.5 transition-colors ${
                isDark ? 'bg-[#0A0A0C] border-[#1E1E24]' : 'bg-white border-[#E2E8F0] shadow-sm'
              }`}
            >
              <div className={`flex items-center justify-between pb-2 border-b ${isDark ? 'border-[#1E1E24]' : 'border-[#E2E8F0]'}`}>
                <span className={isDark ? 'text-[#8E8E93]' : 'text-[#64748B]'}>Apartado de Publicaciones y Subida</span>
                {currentUser.role === 'admin' ? (
                  <span className="text-emerald-500 font-bold flex items-center gap-1 text-[11px]">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Exclusivo Admin
                  </span>
                ) : (
                  <span className="text-red-500 font-bold flex items-center gap-1 text-[11px]">
                    <XCircle className="w-3.5 h-3.5" /> Solo Administradores
                  </span>
                )}
              </div>

              <div className={`flex items-center justify-between pb-2 border-b ${isDark ? 'border-[#1E1E24]' : 'border-[#E2E8F0]'}`}>
                <span className={isDark ? 'text-[#8E8E93]' : 'text-[#64748B]'}>Descargar archivos completos</span>
                <span className="text-emerald-500 font-bold flex items-center gap-1 text-[11px]">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Permitido
                </span>
              </div>

              <div className={`flex items-center justify-between pb-2 border-b ${isDark ? 'border-[#1E1E24]' : 'border-[#E2E8F0]'}`}>
                <span className={isDark ? 'text-[#8E8E93]' : 'text-[#64748B]'}>Dar Me Gusta a publicaciones</span>
                <span className="text-emerald-500 font-bold flex items-center gap-1 text-[11px]">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Permitido
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className={isDark ? 'text-[#8E8E93]' : 'text-[#64748B]'}>Comentar en Foro Privado</span>
                <span className="text-emerald-500 font-bold flex items-center gap-1 text-[11px]">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Permitido
                </span>
              </div>
            </div>
          </div>

          {/* Security & Access Info */}
          <div className="space-y-2">
            <div className={`text-[11px] font-bold tracking-wider uppercase ${isDark ? 'text-[#8E8E93]' : 'text-[#64748B]'}`}>
              Metadatos de Conexión
            </div>

            <div
              className={`border rounded-xl divide-y text-xs transition-colors ${
                isDark
                  ? 'bg-[#0A0A0C] border-[#1E1E24] divide-[#1E1E24]'
                  : 'bg-white border-[#E2E8F0] divide-[#E2E8F0] shadow-sm'
              }`}
            >
              <div className="p-3 flex items-center justify-between gap-2">
                <span className={`flex items-center gap-2 ${isDark ? 'text-[#8E8E93]' : 'text-[#64748B]'}`}>
                  <Key className="w-3.5 h-3.5 text-[#0066FF]" />
                  <span>ID de Usuario</span>
                </span>
                <div className="flex items-center gap-2">
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-extrabold uppercase bg-[#0066FF]/15 text-[#0066FF] border border-[#0066FF]/30">
                    ID ÚNICO
                  </span>
                  <span className={`font-mono text-[11px] truncate max-w-[150px] font-semibold ${isDark ? 'text-white' : 'text-[#0F172A]'}`}>
                    {currentUser.uid}
                  </span>
                  <button
                    type="button"
                    onClick={handleCopyUserId}
                    className="p-1 rounded-md hover:bg-[#0066FF]/15 text-slate-400 hover:text-[#0066FF] transition-colors cursor-pointer"
                    title="Copiar ID de Usuario"
                  >
                    {copiedUid ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              <div className="p-3 flex items-center justify-between">
                <span className={`flex items-center gap-2 ${isDark ? 'text-[#8E8E93]' : 'text-[#64748B]'}`}>
                  <Calendar className="w-3.5 h-3.5 text-[#0066FF]" />
                  <span>Fecha de Registro</span>
                </span>
                <span className={isDark ? 'text-white' : 'text-[#0F172A]'}>
                  {currentUser.joinedAt}
                </span>
              </div>

              <div className="p-3 flex items-center justify-between">
                <span className={`flex items-center gap-2 ${isDark ? 'text-[#8E8E93]' : 'text-[#64748B]'}`}>
                  <Database className="w-3.5 h-3.5 text-[#0066FF]" />
                  <span>Servidor Vault</span>
                </span>
                <span className="text-emerald-500 font-bold flex items-center gap-1 text-[11px]">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping"></span>
                  Conectado
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Logout Button */}
      <motion.button
        id="profile-logout-btn"
        onClick={onLogout}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        className={`w-full py-3.5 px-4 rounded-xl border font-bold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer ${
          isDark
            ? 'border-red-500/30 text-red-400 bg-red-500/10 hover:bg-red-500/20'
            : 'border-red-200 text-red-600 bg-red-50 hover:bg-red-100 shadow-sm'
        }`}
      >
        <LogOut className="w-4 h-4" />
        <span>Cerrar Sesión Segura</span>
      </motion.button>

      {/* MODAL DE EDICIÓN DE PERFIL INDIVIDUAL */}
      <AnimatePresence>
        {showEditModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className={`w-full max-w-md max-h-[90vh] overflow-y-auto custom-scrollbar p-5 rounded-3xl border shadow-2xl ${
                isDark ? 'bg-[#0E0E12] border-[#2A2A35] text-white' : 'bg-white border-[#E2E8F0] text-[#0F172A]'
              }`}
            >
              <div className="flex items-center justify-between pb-3 border-b dark:border-white/10 border-slate-200">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-[#0066FF]/15 flex items-center justify-center text-[#0066FF]">
                    <Edit3 className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold">Editar Perfil Personal</h3>
                    <p className="text-[10px] text-slate-400">Personaliza tus datos individuales</p>
                  </div>
                </div>

                <button
                  onClick={() => setShowEditModal(false)}
                  className="p-1 rounded-full hover:bg-white/10 text-slate-400 cursor-pointer"
                >
                  <XCircle className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleSaveProfile} className="space-y-4 pt-4">
                {/* Selector de Avatar */}
                <div>
                  <label className="block text-xs font-bold mb-2">Foto de Perfil / Avatar</label>
                  
                  {/* Vista previa del avatar actual */}
                  <div className="flex items-center gap-3 mb-3">
                    <img
                      src={editAvatarUrl || `https://api.dicebear.com/7.x/bottts/svg?seed=${currentUser.uid}`}
                      alt="Preview"
                      className="w-14 h-14 rounded-2xl object-cover border-2 border-[#0066FF]"
                    />
                    <div className="flex-1 space-y-1">
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="px-3 py-1.5 rounded-xl bg-slate-200 dark:bg-white/10 hover:bg-[#0066FF] hover:text-white text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5"
                      >
                        <Camera className="w-3.5 h-3.5" />
                        <span>Subir desde dispositivo</span>
                      </button>
                      <input
                        type="file"
                        ref={fileInputRef}
                        onChange={handleAvatarFileUpload}
                        accept="image/*"
                        className="hidden"
                      />
                      <p className="text-[10px] text-slate-400">PNG, JPG o WebP hasta 5MB</p>
                    </div>
                  </div>

                  {/* Galería de avatares rápidos */}
                  <div className="space-y-1.5">
                    <span className="text-[10px] font-semibold text-slate-400">O elige uno de la galería:</span>
                    <div className="grid grid-cols-4 gap-2">
                      {AVATAR_PRESETS.map((preset) => (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() => setEditAvatarUrl(preset.url)}
                          className={`p-1 rounded-xl border flex flex-col items-center gap-1 transition-all cursor-pointer ${
                            editAvatarUrl === preset.url
                              ? 'border-[#0066FF] bg-[#0066FF]/15 scale-105'
                              : 'border-slate-200 dark:border-white/10 hover:border-slate-400'
                          }`}
                        >
                          <img
                            src={preset.url}
                            alt={preset.label}
                            className="w-8 h-8 rounded-lg object-cover"
                          />
                          <span className="text-[9px] font-medium truncate w-full text-center">
                            {preset.label}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Nombre de Usuario */}
                <div>
                  <label className="block text-xs font-bold mb-1">Nombre / Alias</label>
                  <input
                    type="text"
                    required
                    value={editDisplayName}
                    onChange={(e) => setEditDisplayName(e.target.value)}
                    placeholder="Tu nombre público"
                    className={`w-full rounded-xl px-3 py-2 text-xs border focus:outline-none focus:border-[#0066FF] ${
                      isDark ? 'bg-[#1A1A22] border-white/10 text-white' : 'bg-slate-50 border-slate-300 text-slate-900'
                    }`}
                  />
                </div>

                {/* Estado Personalizado */}
                <div>
                  <label className="block text-xs font-bold mb-1">Estado o Lema Corto</label>
                  <input
                    type="text"
                    value={editCustomStatus}
                    onChange={(e) => setEditCustomStatus(e.target.value)}
                    placeholder="Ej: 💎 Coleccionista de recursos VIP"
                    className={`w-full rounded-xl px-3 py-2 text-xs border focus:outline-none focus:border-[#0066FF] ${
                      isDark ? 'bg-[#1A1A22] border-white/10 text-white' : 'bg-slate-50 border-slate-300 text-slate-900'
                    }`}
                  />
                </div>

                {/* WhatsApp / Teléfono */}
                <div>
                  <label className="block text-xs font-bold mb-1">WhatsApp / Contacto Telefónico</label>
                  <input
                    type="tel"
                    value={editPhone}
                    onChange={(e) => setEditPhone(e.target.value)}
                    placeholder="Ej: +54 9 11 1234-5678"
                    className={`w-full rounded-xl px-3 py-2 text-xs border focus:outline-none focus:border-[#0066FF] ${
                      isDark ? 'bg-[#1A1A22] border-white/10 text-white' : 'bg-slate-50 border-slate-300 text-slate-900'
                    }`}
                  />
                  <p className="text-[10px] text-slate-400 mt-0.5">Se utilizará para validar comprobantes y coordinar pagos.</p>
                </div>

                {/* Instagram */}
                <div>
                  <label className="block text-xs font-bold mb-1">Instagram (Opcional)</label>
                  <div className="relative">
                    <span className="absolute left-3 top-2 text-xs text-slate-400">@</span>
                    <input
                      type="text"
                      value={editInstagram.replace(/^@/, '')}
                      onChange={(e) => setEditInstagram(e.target.value)}
                      placeholder="tu_usuario"
                      className={`w-full rounded-xl pl-7 pr-3 py-2 text-xs border focus:outline-none focus:border-[#0066FF] ${
                        isDark ? 'bg-[#1A1A22] border-white/10 text-white' : 'bg-slate-50 border-slate-300 text-slate-900'
                      }`}
                    />
                  </div>
                </div>

                {/* Biografía */}
                <div>
                  <label className="block text-xs font-bold mb-1">Biografía / Sobre mí</label>
                  <textarea
                    rows={3}
                    value={editBio}
                    onChange={(e) => setEditBio(e.target.value)}
                    placeholder="Cuéntanos un poco sobre ti, qué buscas en la bóveda, proyectos, etc..."
                    className={`w-full rounded-xl px-3 py-2 text-xs border focus:outline-none focus:border-[#0066FF] resize-none ${
                      isDark ? 'bg-[#1A1A22] border-white/10 text-white' : 'bg-slate-50 border-slate-300 text-slate-900'
                    }`}
                  />
                </div>

                {/* Botones de acción */}
                <div className="flex gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowEditModal(false)}
                    className="flex-1 py-2.5 rounded-xl border border-slate-300 dark:border-white/10 text-xs font-bold hover:bg-white/5 cursor-pointer"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={isSavingProfile}
                    className="flex-1 py-2.5 rounded-xl bg-[#0066FF] hover:bg-[#0052FF] text-white text-xs font-bold shadow-lg shadow-[#0066FF]/20 cursor-pointer transition-all flex items-center justify-center gap-1.5"
                  >
                    {isSavingProfile ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        <span>Guardando...</span>
                      </>
                    ) : (
                      <>
                        <Check className="w-3.5 h-3.5" />
                        <span>Guardar Cambios</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      </div>
    </div>
  );
};

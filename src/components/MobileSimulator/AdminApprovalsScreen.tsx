import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  ShieldCheck, 
  CheckCircle2, 
  XCircle, 
  Clock, 
  Crown, 
  FileText, 
  Search, 
  ExternalLink, 
  MessageCircle, 
  Eye, 
  Check, 
  X, 
  Sparkles, 
  Calendar, 
  DollarSign, 
  CreditCard, 
  Copy, 
  AlertTriangle, 
  RefreshCw,
  Download,
  Filter,
  UserCheck,
  UserX,
  Lock,
  ArrowUpRight,
  Trash2,
  Upload,
  ZoomIn,
  ShieldAlert,
  Info
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { UserProfile, PaymentReceipt, ReceiptStatus, MembershipPlanType } from '../../types';
import { useTheme } from '../../context/ThemeContext';
import { receiptService } from '../../services/receiptService';
import { firebaseService, resolveApiUrl, safeFetchApi } from '../../services/firebaseService';
import { saveFileLocallyOrDevice } from '../../services/zipExporter';

interface AdminApprovalsScreenProps {
  currentUser: UserProfile;
  onUpdateCurrentUser?: (user: UserProfile) => void;
  onNavigateToVault?: () => void;
  onNavigateToMembership?: () => void;
  onNavigateToReceipts?: () => void;
}

export const AdminApprovalsScreen: React.FC<AdminApprovalsScreenProps> = ({
  currentUser,
  onUpdateCurrentUser,
  onNavigateToVault,
  onNavigateToMembership,
  onNavigateToReceipts,
}) => {
  const { isDark } = useTheme();

  // Receipt list state — approvals screen focuses purely on pending receipts awaiting verification
  const [receipts, setReceipts] = useState<PaymentReceipt[]>(() => 
    receiptService.getAllReceipts().filter((r) => r.status === 'pending')
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastUpdatedTime, setLastUpdatedTime] = useState<string>(() =>
    new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
  );

  // Modal states
  const [lightboxImage, setLightboxImage] = useState<{ url: string; title: string } | null>(null);
  const [approvingReceipt, setApprovingReceipt] = useState<PaymentReceipt | null>(null);
  const [approvalNote, setApprovalNote] = useState('Comprobante verificado con éxito. Membresía VIP activada.');
  
  const [rejectingReceipt, setRejectingReceipt] = useState<PaymentReceipt | null>(null);
  const [rejectReason, setRejectReason] = useState('El comprobante no es legible o los datos no coinciden.');
  const [customRejectReason, setCustomRejectReason] = useState('');

  // Toast notification
  const [toast, setToast] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'success') => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3800);
  };

  const reloadReceipts = async (silent = false) => {
    setIsRefreshing(true);
    try {
      firebaseService.syncAllRegisteredAccountsToDatabase().catch(() => {});

      const synced = await receiptService.syncFromServer();
      const all = Array.isArray(synced) ? synced : receiptService.getAllReceipts();
      // Filtrar estrictamente solo los comprobantes pendientes de aprobación
      const pendingOnly = all.filter((r) => r.status === 'pending');
      setReceipts(pendingOnly);

      const nowStr = new Date().toLocaleTimeString('es-AR', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      });
      setLastUpdatedTime(nowStr);

      if (!silent) {
        if (pendingOnly.length > 0) {
          showToast(`¡Bandeja sincronizada! ${pendingOnly.length} comprobante${pendingOnly.length === 1 ? '' : 's'} pendiente${pendingOnly.length === 1 ? '' : 's'}.`, 'success');
        } else {
          showToast('Bandeja de aprobaciones al día. No hay comprobantes pendientes.', 'info');
        }
      }
    } catch (err) {
      console.warn('Error refreshing receipts:', err);
      const pendingFallback = receiptService.getAllReceipts().filter((r) => r.status === 'pending');
      setReceipts(pendingFallback);
      if (!silent) {
        showToast('Comprobantes actualizados localmente.', 'info');
      }
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    reloadReceipts(true);

    const unsubFirestore = receiptService.onReceiptsSnapshot((liveReceipts) => {
      const pendingOnly = liveReceipts.filter((r) => r.status === 'pending');
      setReceipts(pendingOnly);
      setLastUpdatedTime(
        new Date().toLocaleTimeString('es-AR', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
        })
      );
    });

    const handleUpdate = () => {
      const pendingOnly = receiptService.getAllReceipts().filter((r) => r.status === 'pending');
      setReceipts(pendingOnly);
    };
    window.addEventListener('vault_receipts_changed', handleUpdate);

    // Sync periódica cada 7 segundos para recibir nuevos comprobantes en vivo
    const pollInterval = setInterval(() => {
      receiptService.syncFromServer().then((synced) => {
        if (Array.isArray(synced)) {
          const pendingOnly = synced.filter((r) => r.status === 'pending');
          setReceipts(pendingOnly);
        }
      }).catch(() => {});
    }, 7000);

    return () => {
      unsubFirestore();
      window.removeEventListener('vault_receipts_changed', handleUpdate);
      clearInterval(pollInterval);
    };
  }, []);

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    showToast(`Código "${text}" copiado al portapapeles`, 'info');
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Filtrado por buscador y método
  const [filterType, setFilterType] = useState<'all' | 'monthly' | 'annual' | 'mercadopago' | 'crypto'>('all');

  const filteredReceipts = receipts.filter((r) => {
    if (filterType === 'monthly' && r.plan !== 'monthly' && Number(r.amount) >= 12) return false;
    if (filterType === 'annual' && r.plan !== 'annual' && Number(r.amount) < 12) return false;
    if (filterType === 'mercadopago' && !r.paymentMethod?.toLowerCase().includes('mercado')) return false;
    if (filterType === 'crypto' && !r.paymentMethod?.toLowerCase().includes('usdt') && !r.paymentMethod?.toLowerCase().includes('cripto') && !r.paymentMethod?.toLowerCase().includes('binance')) return false;

    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase().trim();
    return (
      r.userDisplayName?.toLowerCase().includes(query) ||
      r.userEmail?.toLowerCase().includes(query) ||
      r.referenceCode?.toLowerCase().includes(query) ||
      r.paymentMethod?.toLowerCase().includes(query) ||
      r.id.toLowerCase().includes(query)
    );
  });

  const handleDeleteReceiptAdmin = (receipt: PaymentReceipt) => {
    receiptService.deleteReceipt(receipt.id);
    setReceipts((prev) => prev.filter((r) => r.id !== receipt.id));
    showToast(`Comprobante #${receipt.id.slice(-6)} eliminado de la bandeja.`, 'info');
  };

  // Aprobación rápida directa en 1 clic
  const handleQuickApprove = (receipt: PaymentReceipt, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const resolved = receiptService.resolveMembershipByAmount(receipt.amount, receipt.plan);
    const nowIso = new Date().toISOString();
    const expiresIso = new Date(Date.now() + resolved.durationDays * 24 * 60 * 60 * 1000).toISOString();

    const upgradedProfile = firebaseService.upgradeUserMembershipByUidOrEmail(
      receipt.userId,
      receipt.userEmail,
      resolved.plan,
      nowIso,
      resolved.amount,
      expiresIso
    );

    safeFetchApi(`/api/vault/receipts/${encodeURIComponent(receipt.id)}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'approved',
        amount: resolved.amount,
        plan: resolved.plan,
        adminNote: `Aprobado por $${resolved.amount} USD (${resolved.planName})`,
        reviewerName: currentUser.displayName || 'Administrador',
      }),
    }, 2500).catch(() => {});

    if (
      (currentUser.uid === receipt.userId ||
        (receipt.userEmail && currentUser.email.toLowerCase() === receipt.userEmail.toLowerCase())) &&
      onUpdateCurrentUser
    ) {
      onUpdateCurrentUser(
        upgradedProfile || {
          ...currentUser,
          tier: currentUser.role === 'admin' ? 'Bóveda Diamante' : 'Acceso VIP',
          membershipPlan: resolved.plan,
          membershipStatus: 'active',
          subscribedAt: nowIso,
          membershipExpiresAt: expiresIso,
          lastPaymentAmount: resolved.amount,
        }
      );
    }

    // ELIMINAR el comprobante de las aprobaciones inmediatamente
    receiptService.deleteReceipt(receipt.id);
    setReceipts((prev) => prev.filter((r) => r.id !== receipt.id));

    try {
      confetti({ particleCount: 100, spread: 70, origin: { y: 0.5 } });
    } catch {}

    showToast(`¡Comprobante #${receipt.id.slice(-6)} aprobado! VIP activado y retirado de aprobaciones.`, 'success');
  };

  // Rechazo rápido directo en 1 clic
  const handleQuickReject = (receipt: PaymentReceipt, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const reason = 'El comprobante no es legible o los datos no coinciden.';
    firebaseService.denyOrRevokeUserMembershipByUidOrEmail(receipt.userId, receipt.userEmail, reason);

    safeFetchApi(`/api/vault/receipts/${encodeURIComponent(receipt.id)}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'rejected',
        adminNote: reason,
        reviewerName: currentUser.displayName || 'Administrador',
      }),
    }, 2500).catch(() => {});

    receiptService.deleteReceipt(receipt.id);
    setReceipts((prev) => prev.filter((r) => r.id !== receipt.id));

    showToast(`Comprobante #${receipt.id.slice(-6)} rechazado y retirado de aprobaciones.`, 'info');
  };

  // Abrir modal de aprobación
  const openApproveModal = (receipt: PaymentReceipt) => {
    setApprovingReceipt(receipt);
    const resolved = receiptService.resolveMembershipByAmount(receipt.amount, receipt.plan);
    setApprovalNote(
      `Comprobante verificado por $${resolved.amount} USD. Membresía VIP (${resolved.planName} • ${resolved.durationLabel}) activada con éxito.`
    );
  };

  // Confirmar aprobación: Activa la membresía del usuario y ELIMINA el comprobante de las aprobaciones
  const handleConfirmApproval = () => {
    if (!approvingReceipt) return;

    const receipt = approvingReceipt;
    const resolved = receiptService.resolveMembershipByAmount(receipt.amount, receipt.plan);
    const nowIso = new Date().toISOString();
    const expiresIso = new Date(Date.now() + resolved.durationDays * 24 * 60 * 60 * 1000).toISOString();

    // 1. Actualizar cuenta de usuario en Firebase y almacenamiento persistente
    const upgradedProfile = firebaseService.upgradeUserMembershipByUidOrEmail(
      receipt.userId,
      receipt.userEmail,
      resolved.plan,
      nowIso,
      resolved.amount,
      expiresIso
    );

    // 2. Notificar al servidor central para persistir la membresía en users.json
    safeFetchApi(`/api/vault/receipts/${encodeURIComponent(receipt.id)}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'approved',
        amount: resolved.amount,
        plan: resolved.plan,
        adminNote: approvalNote,
        reviewerName: currentUser.displayName || 'Administrador',
      }),
    }, 2500).catch(() => {});

    // 3. Si el usuario actual es quien subió el comprobante, actualizar en memoria
    if (
      (currentUser.uid === receipt.userId ||
        (receipt.userEmail && currentUser.email.toLowerCase() === receipt.userEmail.toLowerCase())) &&
      onUpdateCurrentUser
    ) {
      onUpdateCurrentUser(
        upgradedProfile || {
          ...currentUser,
          tier: currentUser.role === 'admin' ? 'Bóveda Diamante' : 'Acceso VIP',
          membershipPlan: resolved.plan,
          membershipStatus: 'active',
          subscribedAt: nowIso,
          membershipExpiresAt: expiresIso,
          lastPaymentAmount: resolved.amount,
        }
      );
    }

    // 4. ELIMINAR el comprobante de las aprobaciones inmediatamente
    receiptService.deleteReceipt(receipt.id);
    setReceipts((prev) => prev.filter((r) => r.id !== receipt.id));

    // 5. Animación de celebración y mensaje de confirmación
    try {
      confetti({
        particleCount: 120,
        spread: 80,
        origin: { y: 0.5 },
      });
    } catch {}

    showToast(
      `¡Comprobante #${receipt.id.slice(-6)} aprobado! Membresía ${resolved.planName} (${resolved.durationLabel}) activada y comprobante retirado.`,
      'success'
    );
    setApprovingReceipt(null);
  };

  // Abrir modal de rechazo
  const openRejectModal = (receipt: PaymentReceipt) => {
    setRejectingReceipt(receipt);
    setRejectReason('El comprobante no es legible o los datos no coinciden.');
    setCustomRejectReason('');
  };

  // Confirmar rechazo: Marca la denegación y ELIMINA el comprobante de las aprobaciones
  const handleConfirmRejection = () => {
    if (!rejectingReceipt) return;

    const receipt = rejectingReceipt;
    const finalReason = customRejectReason.trim() ? customRejectReason.trim() : rejectReason;

    // 1. Revocar estado si correspondiera
    firebaseService.denyOrRevokeUserMembershipByUidOrEmail(receipt.userId, receipt.userEmail, finalReason);

    // 2. Informar al servidor central
    safeFetchApi(`/api/vault/receipts/${encodeURIComponent(receipt.id)}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'rejected',
        adminNote: finalReason,
        reviewerName: currentUser.displayName || 'Administrador',
      }),
    }, 2500).catch(() => {});

    // 3. ELIMINAR el comprobante de las aprobaciones inmediatamente
    receiptService.deleteReceipt(receipt.id);
    setReceipts((prev) => prev.filter((r) => r.id !== receipt.id));

    showToast(`Comprobante #${receipt.id.slice(-6)} rechazado y retirado de aprobaciones.`, 'info');
    setRejectingReceipt(null);
  };

  const PRESET_REJECT_REASONS = [
    'Comprobante no legible o imagen borrosa',
    'El monto transferido no coincide con el plan',
    'Pago aún no acreditado en la cuenta receptora',
    'Comprobante ya utilizado / duplicado',
    'Código de referencia o datos bancarios erróneos',
  ];

  return (
    <div className={`h-full flex flex-col overflow-y-auto min-h-0 custom-scrollbar pb-28 sm:pb-36 transition-colors ${
      isDark ? 'bg-[#050507] text-white' : 'bg-[#F8FAFC] text-[#0F172A]'
    }`}>
      {/* Toast Notification */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.95 }}
            className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-2xl shadow-2xl border flex items-center gap-3 max-w-md backdrop-blur-2xl ${
              toast.type === 'success'
                ? 'bg-emerald-950/90 border-emerald-500/40 text-emerald-200'
                : toast.type === 'error'
                ? 'bg-rose-950/90 border-rose-500/40 text-rose-200'
                : 'bg-blue-950/90 border-blue-500/40 text-blue-200'
            }`}
          >
            {toast.type === 'success' && <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />}
            {toast.type === 'error' && <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" />}
            {toast.type === 'info' && <Info className="w-5 h-5 text-blue-400 shrink-0" />}
            <span className="text-xs font-semibold leading-relaxed">{toast.message}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Screen Header */}
      <div className={`px-4 sm:px-6 py-4 border-b shrink-0 flex flex-wrap items-center justify-between gap-3 sticky top-0 z-20 backdrop-blur-2xl ${
        isDark ? 'border-white/[0.08] bg-[#050507]/90' : 'border-slate-200 bg-white/90 shadow-xs'
      }`}>
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-[#0066FF] to-blue-800 flex items-center justify-center text-white shadow-lg shadow-[#0066FF]/30 border border-blue-400/20">
            <ShieldCheck className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base sm:text-lg font-black tracking-tight">
                Aprobación de Membresías
              </h1>
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                Panel Admin
              </span>
            </div>
            <p className={`text-xs mt-0.5 ${isDark ? 'text-zinc-400' : 'text-slate-500'}`}>
              Bandeja de verificación de comprobantes. Al aprobar o rechazar, el comprobante se retira automáticamente.
            </p>
          </div>
        </div>

        {/* Top actions */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-[10px] font-mono hidden sm:inline-block px-2.5 py-1 rounded-xl border ${
            isDark ? 'border-white/[0.06] bg-white/[0.02] text-zinc-400' : 'border-slate-200 bg-slate-100 text-slate-600'
          }`}>
            Sincronizado: {lastUpdatedTime}
          </span>

          {onNavigateToReceipts && (
            <button
              type="button"
              onClick={onNavigateToReceipts}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl border text-xs font-bold transition-all cursor-pointer active:scale-95 ${
                isDark
                  ? 'bg-white/[0.04] border-white/[0.1] hover:bg-white/[0.08] text-zinc-200'
                  : 'bg-slate-100 border-slate-200 hover:bg-slate-200 text-slate-800'
              }`}
              title="Ir a Subir / Ver Comprobantes"
            >
              <Upload className="w-3.5 h-3.5 text-[#0066FF]" />
              <span>Subir Comprobante</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => reloadReceipts(false)}
            disabled={isRefreshing}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer active:scale-95 bg-[#0066FF] hover:bg-blue-600 text-white shadow-lg shadow-[#0066FF]/25 border border-blue-400/30"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            <span>{isRefreshing ? 'Actualizando...' : 'Actualizar'}</span>
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 p-3 sm:p-6 max-w-5xl w-full mx-auto space-y-6">

        {/* Top Metrics Banner */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {/* Pendientes */}
          <div className={`p-4 rounded-3xl border transition-all relative overflow-hidden ${
            receipts.length > 0
              ? 'bg-amber-500/[0.08] border-amber-500/30 ring-1 ring-inset ring-amber-500/20'
              : isDark
              ? 'bg-zinc-950/70 border-white/[0.08]'
              : 'bg-white border-slate-200'
          }`}>
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-amber-400 flex items-center gap-1.5 uppercase tracking-wider">
                <Clock className="w-4 h-4" /> Comprobantes Pendientes
              </span>
              {receipts.length > 0 && (
                <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-ping" />
              )}
            </div>
            <div className="mt-2.5 flex items-baseline gap-2">
              <span className="text-3xl font-black text-amber-400">{receipts.length}</span>
              <span className={`text-xs ${isDark ? 'text-zinc-400' : 'text-slate-500'}`}>
                {receipts.length === 1 ? 'por verificar' : 'por verificar'}
              </span>
            </div>
          </div>

          {/* Regla de negocio: Retiro automático */}
          <div className={`p-4 rounded-3xl border transition-all ${
            isDark ? 'bg-zinc-950/70 border-white/[0.08]' : 'bg-white border-slate-200'
          }`}>
            <span className="text-xs font-bold text-[#0066FF] flex items-center gap-1.5 uppercase tracking-wider">
              <Sparkles className="w-4 h-4" /> Flujo de Aprobación
            </span>
            <p className={`text-xs mt-2 leading-relaxed ${isDark ? 'text-zinc-300' : 'text-slate-600'}`}>
              Al pulsar <strong>Aprobar</strong>, el usuario recibe su acceso VIP inmediatamente y el comprobante se retira de la lista.
            </p>
          </div>

          {/* Estado de la Bandeja */}
          <div className={`p-4 rounded-3xl border transition-all ${
            receipts.length === 0
              ? 'bg-emerald-500/[0.08] border-emerald-500/30'
              : isDark ? 'bg-zinc-950/70 border-white/[0.08]' : 'bg-white border-slate-200'
          }`}>
            <span className="text-xs font-bold text-emerald-400 flex items-center gap-1.5 uppercase tracking-wider">
              <CheckCircle2 className="w-4 h-4" /> Estado de la Bandeja
            </span>
            <div className="mt-2">
              <span className="text-xs font-bold text-emerald-300">
                {receipts.length === 0 ? '✓ Bandeja limpia al 100%' : '● Hay tareas pendientes de revisión'}
              </span>
              <p className={`text-[11px] mt-0.5 ${isDark ? 'text-zinc-400' : 'text-slate-500'}`}>
                {receipts.length === 0 ? 'Todos los pagos han sido atendidos.' : 'Revisa y toma acción abajo.'}
              </p>
            </div>
          </div>
        </div>

        {/* Search Bar & Filter Pills */}
        <div className="space-y-2.5">
          <div className={`p-2.5 rounded-2xl border flex items-center gap-2.5 ${
            isDark ? 'bg-zinc-950/80 border-white/[0.08]' : 'bg-white border-slate-200 shadow-xs'
          }`}>
            <Search className="w-4 h-4 text-zinc-400 ml-2 shrink-0" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar por usuario, correo electrónico, método de pago o código de referencia..."
              className={`w-full bg-transparent text-xs py-1 focus:outline-none placeholder-zinc-500 ${
                isDark ? 'text-white' : 'text-slate-900'
              }`}
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="text-xs text-zinc-400 hover:text-white px-2 py-0.5 rounded-lg cursor-pointer"
              >
                Limpiar
              </button>
            )}
          </div>

          {/* Quick Filter Pills */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {[
              { id: 'all', label: `Todos (${receipts.length})` },
              { id: 'monthly', label: 'Plan Mensual ($1)' },
              { id: 'annual', label: 'Plan Anual ($12)' },
              { id: 'mercadopago', label: 'Mercado Pago' },
              { id: 'crypto', label: 'Cripto / USDT' },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilterType(tab.id as any)}
                className={`px-3 py-1 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                  filterType === tab.id
                    ? 'bg-[#0066FF] text-white shadow-md shadow-[#0066FF]/25 border border-blue-400/30'
                    : isDark
                    ? 'bg-zinc-900/80 text-zinc-400 hover:text-white border border-white/5 hover:border-white/10'
                    : 'bg-slate-100 text-slate-600 hover:text-slate-900 border border-slate-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* List of Pending Receipts */}
        {filteredReceipts.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className={`p-10 rounded-3xl border text-center flex flex-col items-center justify-center space-y-3 ${
              isDark ? 'bg-zinc-950/60 border-white/[0.08]' : 'bg-white border-slate-200 shadow-xs'
            }`}
          >
            <div className="w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center text-emerald-400 mb-1">
              <ShieldCheck className="w-8 h-8" />
            </div>
            <h3 className="text-base font-black tracking-tight">
              {searchQuery ? 'No se encontraron comprobantes con esa búsqueda' : '¡Bandeja de Aprobaciones al Día!'}
            </h3>
            <p className={`text-xs max-w-md leading-relaxed ${isDark ? 'text-zinc-400' : 'text-slate-500'}`}>
              {searchQuery
                ? 'Prueba modificando los términos de búsqueda o limpiando el filtro.'
                : 'No hay comprobantes pendientes en este momento. Cuando los usuarios envíen una captura de pago, se listará aquí para su aprobación inmediata.'}
            </p>
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="mt-2 px-4 py-2 rounded-xl text-xs font-bold bg-[#0066FF] text-white cursor-pointer"
              >
                Ver todos los pendientes
              </button>
            )}
          </motion.div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between px-1">
              <span className="text-xs font-bold text-zinc-400 uppercase tracking-wider">
                Comprobantes en espera ({filteredReceipts.length})
              </span>
              <span className="text-[11px] text-zinc-500">
                Pulsar una imagen para ampliarla en detalle
              </span>
            </div>

            <AnimatePresence mode="popLayout">
              {filteredReceipts.map((receipt) => {
                const resolved = receiptService.resolveMembershipByAmount(receipt.amount, receipt.plan);
                const isMonthly = resolved.plan === 'monthly';

                return (
                  <motion.div
                    key={receipt.id}
                    layout
                    initial={{ opacity: 0, scale: 0.98, y: 8 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: -10 }}
                    transition={{ duration: 0.2 }}
                    className={`p-4 sm:p-5 rounded-3xl border transition-all relative overflow-hidden backdrop-blur-xl ${
                      isDark
                        ? 'bg-zinc-950/80 border-white/[0.08] hover:border-white/[0.15] ring-1 ring-inset ring-white/[0.04]'
                        : 'bg-white border-slate-200 hover:border-slate-300 shadow-md ring-1 ring-inset ring-slate-100'
                    }`}
                  >
                    {/* Glowing highlight indicator */}
                    <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-amber-400 via-[#0066FF] to-emerald-400 opacity-70" />

                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mt-1">
                      
                      {/* Left: User info and transaction metadata */}
                      <div className="space-y-2.5 min-w-0 flex-1">
                        {/* User Header */}
                        <div className="flex items-center gap-3">
                          <img
                            src={
                              receipt.userAvatar ||
                              `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(receipt.userEmail || receipt.userId)}&backgroundColor=0066fe,0052ff`
                            }
                            alt={receipt.userDisplayName}
                            className="w-10 h-10 rounded-2xl object-cover border border-white/10 shrink-0 bg-zinc-900"
                          />
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <h3 className="text-sm font-black truncate">
                                {receipt.userDisplayName || 'Usuario'}
                              </h3>
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-amber-500/15 text-amber-400 border border-amber-500/30 flex items-center gap-1">
                                <Clock className="w-3 h-3" /> Pendiente
                              </span>
                            </div>
                            <p className="text-xs text-zinc-400 truncate font-mono">
                              {receipt.userEmail || 'Sin email registrado'}
                            </p>
                          </div>
                        </div>

                        {/* Plan & Amount Breakdown */}
                        <div className="flex items-center gap-2 flex-wrap text-xs">
                          <span className={`px-2.5 py-1 rounded-xl font-bold border flex items-center gap-1.5 ${
                            isMonthly
                              ? 'bg-blue-500/10 text-blue-400 border-blue-500/30'
                              : 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                          }`}>
                            <Crown className="w-3.5 h-3.5" />
                            {resolved.planName.toUpperCase()} (${resolved.amount} USD • {resolved.durationLabel})
                          </span>

                          <span className={`px-2.5 py-1 rounded-xl font-bold border flex items-center gap-1.5 ${
                            isDark ? 'bg-white/[0.04] border-white/[0.08] text-zinc-300' : 'bg-slate-100 border-slate-200 text-slate-700'
                          }`}>
                            <CreditCard className="w-3.5 h-3.5 text-[#0066FF]" />
                            {receipt.paymentMethod || 'Transferencia'}
                          </span>

                          {receipt.referenceCode && (
                            <button
                              type="button"
                              onClick={() => handleCopy(receipt.referenceCode!, receipt.id)}
                              className={`px-2.5 py-1 rounded-xl font-mono text-[11px] border flex items-center gap-1 cursor-pointer transition-colors ${
                                isDark ? 'bg-white/[0.04] border-white/[0.08] hover:bg-white/[0.08] text-zinc-300' : 'bg-slate-100 border-slate-200 hover:bg-slate-200 text-slate-800'
                              }`}
                              title="Copiar código de referencia"
                            >
                              <Copy className="w-3 h-3 text-zinc-400" />
                              <span>Ref: {receipt.referenceCode}</span>
                              {copiedId === receipt.id && <span className="text-emerald-400 font-bold ml-0.5">✓</span>}
                            </button>
                          )}
                        </div>

                        {/* Notes if any */}
                        {receipt.notes && (
                          <div className={`p-2.5 rounded-2xl border text-xs italic ${
                            isDark ? 'bg-black/40 border-white/[0.06] text-zinc-300' : 'bg-slate-50 border-slate-200 text-slate-600'
                          }`}>
                            <span className="font-bold not-italic text-zinc-400">Nota del usuario: </span>
                            "{receipt.notes}"
                          </div>
                        )}

                        <div className="flex items-center gap-3 text-[11px] text-zinc-400 font-mono">
                          <span>ID: #{receipt.id.slice(-8)}</span>
                          <span>•</span>
                          <span>{new Date(receipt.createdAt).toLocaleString('es-AR')}</span>
                        </div>
                      </div>

                      {/* Center/Right: Receipt thumbnail & zoom button */}
                      <div className="flex items-center gap-4 shrink-0">
                        {receipt.receiptImageUrl && (
                          <div
                            onClick={() => setLightboxImage({ url: receipt.receiptImageUrl, title: `Comprobante de ${receipt.userDisplayName}` })}
                            className="relative group w-24 h-24 sm:w-28 sm:h-28 rounded-2xl overflow-hidden border border-white/15 cursor-pointer shadow-md bg-black/60 shrink-0"
                          >
                            <img
                              src={receipt.receiptImageUrl}
                              alt="Comprobante"
                              className="w-full h-full object-cover transition-transform group-hover:scale-105 duration-300"
                            />
                            <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white">
                              <ZoomIn className="w-6 h-6" />
                            </div>
                            <span className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded-md text-[9px] font-bold bg-black/80 text-white backdrop-blur-xs">
                              Ampliar
                            </span>
                          </div>
                        )}

                        {/* Action Buttons Column */}
                        <div className="flex flex-col gap-2 shrink-0 min-w-[160px]">
                          {/* 1-Click Quick Approve */}
                          <button
                            type="button"
                            onClick={(e) => handleQuickApprove(receipt, e)}
                            className="w-full py-2.5 px-3.5 rounded-xl font-black text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 text-black shadow-lg shadow-emerald-500/25 transition-all cursor-pointer active:scale-95"
                            title="Aprobar inmediatamente en 1 clic y retirar de la bandeja"
                          >
                            <Check className="w-4 h-4 stroke-[3]" />
                            <span>Aprobar Rápido (1 Clic)</span>
                          </button>

                          {/* Approve with custom note (Modal) */}
                          <button
                            type="button"
                            onClick={() => openApproveModal(receipt)}
                            className={`w-full py-1.5 px-2.5 rounded-xl font-bold text-[11px] border flex items-center justify-center gap-1 transition-all cursor-pointer ${
                              isDark ? 'border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10' : 'border-emerald-300 text-emerald-700 hover:bg-emerald-50'
                            }`}
                            title="Personalizar nota de aprobación"
                          >
                            <span>Aprobar con Nota...</span>
                          </button>

                          {/* Quick Reject or Modal Reject */}
                          <div className="grid grid-cols-2 gap-1.5">
                            <button
                              type="button"
                              onClick={(e) => handleQuickReject(receipt, e)}
                              className={`py-2 px-2 rounded-xl font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-1 border transition-all cursor-pointer active:scale-95 ${
                                isDark
                                  ? 'border-rose-500/40 text-rose-400 hover:bg-rose-500/10'
                                  : 'border-rose-300 text-rose-600 hover:bg-rose-50'
                              }`}
                              title="Rechazar directamente"
                            >
                              <X className="w-3.5 h-3.5" />
                              <span>Rechazar</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => openRejectModal(receipt)}
                              className={`py-2 px-2 rounded-xl font-bold text-[10px] border flex items-center justify-center text-zinc-400 hover:text-white transition-all cursor-pointer ${
                                isDark ? 'border-white/10 hover:bg-white/5' : 'border-slate-300 hover:bg-slate-100'
                              }`}
                              title="Elegir motivo específico de rechazo"
                            >
                              <span>Con motivo...</span>
                            </button>
                          </div>

                          <button
                            type="button"
                            onClick={() => handleDeleteReceiptAdmin(receipt)}
                            className={`w-full py-1.5 px-2 rounded-xl text-[10px] font-bold flex items-center justify-center gap-1 text-zinc-500 hover:text-rose-400 transition-colors cursor-pointer`}
                            title="Eliminar de la cola sin procesar"
                          >
                            <Trash2 className="w-3 h-3" />
                            <span>Quitar de cola</span>
                          </button>
                        </div>

                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}

      </div>

      {/* Lightbox Image Preview Modal */}
      <AnimatePresence>
        {lightboxImage && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setLightboxImage(null)}
            className="fixed inset-0 z-50 bg-black/90 backdrop-blur-2xl p-4 flex flex-col items-center justify-center"
          >
            <div className="relative max-w-2xl w-full max-h-[85vh] flex flex-col items-center">
              <div className="w-full flex items-center justify-between pb-3 text-white">
                <span className="text-sm font-bold truncate">{lightboxImage.title}</span>
                <button
                  type="button"
                  onClick={() => setLightboxImage(null)}
                  className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="relative rounded-2xl overflow-hidden border border-white/20 max-h-[75vh] w-full flex items-center justify-center bg-black">
                <img
                  src={lightboxImage.url}
                  alt={lightboxImage.title}
                  className="max-h-[75vh] max-w-full object-contain"
                />
              </div>

              <div className="mt-3 flex items-center gap-3">
                <button
                  type="button"
                  className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-bold flex items-center gap-2 cursor-pointer transition-all active:scale-95"
                  onClick={async (e) => {
                    e.stopPropagation();
                    try {
                      const resp = await fetch(lightboxImage.url);
                      const blob = await resp.blob();
                      await saveFileLocallyOrDevice(blob, 'comprobante_pago.jpg', 'image/jpeg');
                    } catch (dlErr) {
                      console.warn('Download error:', dlErr);
                    }
                  }}
                >
                  <Download className="w-4 h-4" />
                  Descargar Imagen
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Approval Confirmation Modal */}
      <AnimatePresence>
        {approvingReceipt && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xl p-4 flex items-center justify-center"
          >
            <motion.div
              initial={{ scale: 0.95, y: 10 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 10 }}
              className={`max-w-md w-full p-6 rounded-3xl border shadow-2xl space-y-4 ${
                isDark ? 'bg-zinc-950 border-white/10 text-white' : 'bg-white border-slate-200 text-slate-900'
              }`}
            >
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0 border border-emerald-500/30">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-base font-black">Aprobar y Activar Membresía VIP</h3>
                  <p className="text-xs text-zinc-400">
                    Al confirmar, el usuario subirá a VIP y el comprobante se retirará de las aprobaciones.
                  </p>
                </div>
              </div>

              <div className={`p-4 rounded-2xl border space-y-2 text-xs ${
                isDark ? 'bg-black/50 border-white/[0.08]' : 'bg-slate-50 border-slate-200'
              }`}>
                <div className="flex justify-between">
                  <span className="text-zinc-400">Usuario:</span>
                  <span className="font-bold">{approvingReceipt.userDisplayName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-400">Email:</span>
                  <span className="font-mono">{approvingReceipt.userEmail || 'Sin email'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-400">Monto Abonado:</span>
                  <span className="font-black text-emerald-400">${approvingReceipt.amount} USD</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-400">Plan a Activar:</span>
                  <span className="font-bold text-[#0066FF]">
                    {receiptService.resolveMembershipByAmount(approvingReceipt.amount, approvingReceipt.plan).planName} (
                    {receiptService.resolveMembershipByAmount(approvingReceipt.amount, approvingReceipt.plan).durationLabel})
                  </span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold mb-1.5 text-zinc-400 uppercase tracking-wider">
                  Nota del Administrador (opcional)
                </label>
                <input
                  type="text"
                  value={approvalNote}
                  onChange={(e) => setApprovalNote(e.target.value)}
                  className={`w-full px-3.5 py-2.5 rounded-xl border text-xs focus:outline-none focus:border-[#0066FF] ${
                    isDark ? 'bg-black/60 border-white/10 text-white' : 'bg-slate-100 border-slate-300 text-black'
                  }`}
                />
              </div>

              <div className="flex items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setApprovingReceipt(null)}
                  className={`flex-1 py-3 rounded-xl font-bold text-xs border transition-colors cursor-pointer ${
                    isDark ? 'border-white/10 hover:bg-white/5 text-zinc-300' : 'border-slate-300 hover:bg-slate-100 text-slate-700'
                  }`}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleConfirmApproval}
                  className="flex-1 py-3 rounded-xl font-black text-xs uppercase tracking-wider bg-emerald-500 hover:bg-emerald-400 text-black transition-all shadow-lg shadow-emerald-500/25 cursor-pointer"
                >
                  Confirmar y Activar VIP
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Rejection Modal */}
      <AnimatePresence>
        {rejectingReceipt && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xl p-4 flex items-center justify-center"
          >
            <motion.div
              initial={{ scale: 0.95, y: 10 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 10 }}
              className={`max-w-md w-full p-6 rounded-3xl border shadow-2xl space-y-4 ${
                isDark ? 'bg-zinc-950 border-white/10 text-white' : 'bg-white border-slate-200 text-slate-900'
              }`}
            >
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-rose-500/20 text-rose-400 flex items-center justify-center shrink-0 border border-rose-500/30">
                  <XCircle className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-base font-black">Rechazar Comprobante</h3>
                  <p className="text-xs text-zinc-400">
                    El comprobante se retirará de la cola de aprobaciones.
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wider">
                  Motivo de rechazo:
                </label>
                <div className="space-y-1.5">
                  {PRESET_REJECT_REASONS.map((reason) => (
                    <div
                      key={reason}
                      onClick={() => {
                        setRejectReason(reason);
                        setCustomRejectReason('');
                      }}
                      className={`p-2.5 rounded-xl border text-xs cursor-pointer transition-all ${
                        rejectReason === reason && !customRejectReason
                          ? 'bg-rose-500/15 border-rose-500/40 text-rose-300 font-bold'
                          : isDark
                          ? 'bg-black/40 border-white/[0.06] text-zinc-400 hover:text-white'
                          : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      {reason}
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold mb-1 text-zinc-400 uppercase tracking-wider">
                  O motivo personalizado:
                </label>
                <input
                  type="text"
                  value={customRejectReason}
                  onChange={(e) => setCustomRejectReason(e.target.value)}
                  placeholder="Escribe un motivo específico..."
                  className={`w-full px-3.5 py-2.5 rounded-xl border text-xs focus:outline-none focus:border-rose-500 ${
                    isDark ? 'bg-black/60 border-white/10 text-white' : 'bg-slate-100 border-slate-300 text-black'
                  }`}
                />
              </div>

              <div className="flex items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setRejectingReceipt(null)}
                  className={`flex-1 py-3 rounded-xl font-bold text-xs border transition-colors cursor-pointer ${
                    isDark ? 'border-white/10 hover:bg-white/5 text-zinc-300' : 'border-slate-300 hover:bg-slate-100 text-slate-700'
                  }`}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleConfirmRejection}
                  className="flex-1 py-3 rounded-xl font-black text-xs uppercase tracking-wider bg-rose-600 hover:bg-rose-500 text-white transition-all shadow-lg shadow-rose-600/25 cursor-pointer"
                >
                  Confirmar y Retirar
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

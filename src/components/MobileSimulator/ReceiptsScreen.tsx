import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Upload, FileText, CheckCircle2, Clock, AlertCircle, XCircle, 
  MessageCircle, ExternalLink, Image as ImageIcon, Check, ChevronRight,
  ShieldCheck, RefreshCw, Trash2, Eye, Filter, ArrowLeft, Send, Sparkles,
  DollarSign, Calendar, CreditCard, User, Info, AlertTriangle, Shield
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { UserProfile, PaymentReceipt, ReceiptStatus, MembershipPlanType } from '../../types';
import { useTheme } from '../../context/ThemeContext';
import { receiptService } from '../../services/receiptService';
import { firebaseService, safeFetchApi } from '../../services/firebaseService';
import { WHATSAPP_CONTACT_PHONE, WHATSAPP_PHONE_RAW } from './MembershipScreen';
import { saveFileLocallyOrDevice } from '../../services/zipExporter';

interface ReceiptsScreenProps {
  currentUser: UserProfile;
  onUpdateUser?: (updated: UserProfile) => void;
  onNavigateToMembership?: () => void;
  onNavigateToVault?: () => void;
  onNavigateToApprovals?: () => void;
}

export const ReceiptsScreen: React.FC<ReceiptsScreenProps> = ({
  currentUser,
  onUpdateUser,
  onNavigateToMembership,
  onNavigateToVault,
  onNavigateToApprovals,
}) => {
  const { isDark } = useTheme();
  const isAdmin = currentUser.role === 'admin';
  const isSubscribed = Boolean(
    currentUser.membershipStatus === 'active' ||
    (currentUser.membershipPlan && currentUser.membershipStatus !== 'cancelled' && currentUser.membershipStatus !== 'none') ||
    currentUser.tier === 'Acceso VIP' ||
    currentUser.tier === 'Bóveda Diamante' ||
    currentUser.role === 'admin'
  );

  // Navigation tab inside Receipts screen — default to 'history' for Admin so uploaded receipts are immediately visible
  const [activeTab, setActiveTab] = useState<'upload' | 'history'>(() =>
    isAdmin ? 'history' : 'upload'
  );
  
  // Receipts state
  const [receipts, setReceipts] = useState<PaymentReceipt[]>(() => {
    return isAdmin 
      ? receiptService.getAllReceipts()
      : receiptService.getReceiptsByUser(currentUser.uid, currentUser.email);
  });

  // Admin filter
  const [statusFilter, setStatusFilter] = useState<ReceiptStatus | 'all'>('all');

  // Form states
  const [selectedPlan, setSelectedPlan] = useState<MembershipPlanType>('monthly');
  const [amount, setAmount] = useState<number>(1);
  const [paymentMethod, setPaymentMethod] = useState<string>('Mercado Pago');
  const [referenceCode, setReferenceCode] = useState<string>('');
  const [whatsappPhone, setWhatsappPhone] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [fileSizeKb, setFileSizeKb] = useState<number | null>(null);
  const [isCompressingImage, setIsCompressingImage] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sendWhatsAppAlert, setSendWhatsAppAlert] = useState(false);

  // Selected receipt for detailed preview
  const [viewingReceipt, setViewingReceipt] = useState<PaymentReceipt | null>(null);
  const [isRefreshingReceipts, setIsRefreshingReceipts] = useState(false);

  // Notification Toast
  const [toast, setToast] = useState<{ type: 'success' | 'info' | 'error'; message: string } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Sync receipts on event
  const refreshReceipts = () => {
    if (isAdmin) {
      setReceipts(receiptService.getAllReceipts());
    } else {
      setReceipts(receiptService.getReceiptsByUser(currentUser.uid, currentUser.email));
    }
  };

  const handleManualSyncReceipts = async (silent = false) => {
    setIsRefreshingReceipts(true);
    refreshReceipts();
    try {
      const [synced] = await Promise.all([
        receiptService.syncFromServer(),
        new Promise((r) => setTimeout(r, silent ? 100 : 350)),
      ]);
      if (isAdmin) {
        setReceipts(synced);
      } else {
        setReceipts(receiptService.getReceiptsByUser(currentUser.uid, currentUser.email));
      }
      if (!silent) {
        showToast('¡Lista de comprobantes actualizada!', 'info');
      }
    } catch {
      refreshReceipts();
    } finally {
      setIsRefreshingReceipts(false);
    }
  };

  useEffect(() => {
    handleManualSyncReceipts(true);

    const unsubFirestore = receiptService.onReceiptsSnapshot(() => {
      refreshReceipts();
    });

    const handleUpdate = () => {
      refreshReceipts();
    };
    window.addEventListener('vault_receipts_changed', handleUpdate);

    const pollInterval = setInterval(() => {
      receiptService
        .syncFromServer()
        .then(() => {
          refreshReceipts();
        })
        .catch(() => {});
    }, 5000);

    return () => {
      unsubFirestore();
      window.removeEventListener('vault_receipts_changed', handleUpdate);
      clearInterval(pollInterval);
    };
  }, [currentUser.uid, currentUser.email, isAdmin]);

  const resolvedUploadMembership = receiptService.resolveMembershipByAmount(amount, selectedPlan);

  const handleSelectPlanCard = (plan: MembershipPlanType) => {
    setSelectedPlan(plan);
    setAmount(plan === 'annual' ? 12 : 1);
  };

  const handleAmountChange = (val: number) => {
    setAmount(val);
    if (!isNaN(val) && val > 0) {
      setSelectedPlan(val >= 12 ? 'annual' : 'monthly');
    }
  };

  const showToast = (message: string, type: 'success' | 'info' | 'error' = 'success') => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 4500);
  };

  const handleGenerateRefCode = () => {
    const randomCode = `REF-${Math.floor(100000 + Math.random() * 900000)}`;
    setReferenceCode(randomCode);
    showToast(`Código generado: ${randomCode}`, 'info');
  };

  // Handle file selection and read + compress as base64
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 25 * 1024 * 1024) {
      showToast('El archivo supera los 25MB. Elige una imagen más liviana.', 'error');
      return;
    }

    setFileName(file.name);
    setIsCompressingImage(true);

    const reader = new FileReader();
    reader.onload = async () => {
      if (typeof reader.result === 'string') {
        const rawDataUrl = reader.result;
        try {
          const compressed = await receiptService.compressReceiptImage(rawDataUrl);
          setPreviewImage(compressed);
          const kb = Math.round((compressed.length * 3) / 4 / 1024);
          setFileSizeKb(kb);
        } catch {
          setPreviewImage(rawDataUrl);
          const kb = Math.round(file.size / 1024);
          setFileSizeKb(kb);
        } finally {
          setIsCompressingImage(false);
        }
      }
    };
    reader.onerror = () => {
      setIsCompressingImage(false);
      showToast('No se pudo leer la imagen seleccionada.', 'error');
    };
    reader.readAsDataURL(file);
  };

  // Submit new receipt
  const handleSubmitReceipt = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!previewImage) {
      showToast('Por favor adjunta la foto o captura del comprobante.', 'error');
      return;
    }

    setIsSubmitting(true);

    try {
      const payload = {
        userId: currentUser?.uid || `usr_${Date.now()}`,
        userDisplayName: currentUser?.displayName || 'Usuario',
        userEmail: currentUser?.email || '',
        userAvatar: currentUser?.avatarUrl,
        plan: resolvedUploadMembership.plan,
        amount: resolvedUploadMembership.amount,
        paymentMethod,
        referenceCode: referenceCode.trim() || undefined,
        receiptImageUrl: previewImage,
        receiptFileName: fileName || 'comprobante_pago.jpg',
        notes: notes.trim() || undefined,
        whatsappContact: whatsappPhone.trim() || undefined,
      };

      const newRec = await receiptService.createReceiptAsync(payload);

      // Immediately add to local screen state so it's guaranteed visible in history
      setReceipts((prev) => [newRec, ...prev.filter((r) => r.id !== newRec.id)]);

      // Confetti burst
      try {
        confetti({
          particleCount: 80,
          spread: 60,
          origin: { y: 0.6 },
        });
      } catch {}

      showToast(
        `¡Comprobante #${newRec.id.slice(-6)} por $${newRec.amount} USD enviado con éxito! Ya está en la bandeja de revisión.`,
        'success'
      );

      // Reset form and switch to history view immediately
      setPreviewImage(null);
      setFileName('');
      setFileSizeKb(null);
      setReferenceCode('');
      setNotes('');
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      setActiveTab('history');
      refreshReceipts();
    } catch (err) {
      console.error(err);
      showToast('Ocurrió un error al guardar el comprobante.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Admin action: Approve receipt and activate VIP, then delete receipt from approvals queue
  const handleApproveReceipt = (receipt: PaymentReceipt) => {
    const resolved = receiptService.resolveMembershipByAmount(receipt.amount, receipt.plan);
    const nowIso = new Date().toISOString();
    const expiresIso = new Date(Date.now() + resolved.durationDays * 24 * 60 * 60 * 1000).toISOString();

    // 1. Upgrade the specific user account associated with the receipt
    const upgradedProfile = firebaseService.upgradeUserMembershipByUidOrEmail(
      receipt.userId,
      receipt.userEmail,
      resolved.plan,
      nowIso,
      resolved.amount,
      expiresIso
    );

    // 2. If the current user happens to be the one who owns it, also update in-memory
    if (
      (currentUser.uid === receipt.userId ||
        (receipt.userEmail && currentUser.email.toLowerCase() === receipt.userEmail.toLowerCase())) &&
      onUpdateUser
    ) {
      onUpdateUser(
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

    // 3. Patch central server to register upgrade and delete receipt from server storage
    safeFetchApi(`/api/vault/receipts/${encodeURIComponent(receipt.id)}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'approved',
        amount: resolved.amount,
        plan: resolved.plan,
        adminNote: `Comprobante verificado con éxito. Membresía VIP (${resolved.planName}) activada.`,
        reviewerName: currentUser.displayName || 'Administrador',
      }),
    }, 2000).catch(() => {});

    // 4. Borrar el comprobante de la lista de aprobaciones y base de datos
    receiptService.deleteReceipt(receipt.id);
    setReceipts((prev) => prev.filter((r) => r.id !== receipt.id));
    if (viewingReceipt && viewingReceipt.id === receipt.id) {
      setViewingReceipt(null);
    }

    confetti({ particleCount: 100, spread: 70, origin: { y: 0.5 } });
    showToast(
      `¡Comprobante #${receipt.id.slice(-6)} aprobado y retirado de aprobaciones! Se activó ${resolved.planName} (${resolved.durationLabel}).`,
      'success'
    );
  };

  // Admin action: Reject receipt and delete from approvals queue
  const handleRejectReceipt = (receipt: PaymentReceipt) => {
    const reason = 'El comprobante no es legible o el pago aún no fue acreditado.';
    firebaseService.denyOrRevokeUserMembershipByUidOrEmail(receipt.userId, receipt.userEmail, reason);
    safeFetchApi(`/api/vault/receipts/${encodeURIComponent(receipt.id)}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'rejected',
        adminNote: reason,
        reviewerName: currentUser.displayName || 'Administrador',
      }),
    }, 2000).catch(() => {});
    receiptService.deleteReceipt(receipt.id);
    setReceipts((prev) => prev.filter((r) => r.id !== receipt.id));
    if (viewingReceipt && viewingReceipt.id === receipt.id) {
      setViewingReceipt(null);
    }
    showToast(`Comprobante #${receipt.id.slice(-6)} rechazado y retirado de aprobaciones.`, 'info');
  };

  // User action: Delete pending receipt
  const handleDeleteReceipt = (receiptId: string) => {
    receiptService.deleteReceipt(receiptId);
    showToast('Comprobante eliminado.', 'info');
    refreshReceipts();
    if (viewingReceipt?.id === receiptId) {
      setViewingReceipt(null);
    }
  };

  // Filtered list for display
  const displayedReceipts = receipts.filter((r) => {
    if (statusFilter === 'all') return true;
    return r.status === statusFilter;
  });

  const pendingCount = receipts.filter((r) => r.status === 'pending').length;

  return (
    <div className={`h-full flex flex-col overflow-y-auto min-h-0 custom-scrollbar pb-28 sm:pb-36 transition-colors ${
      isDark ? 'bg-black text-white' : 'bg-[#F8FAFC] text-[#0F172A]'
    }`}>
      {/* Toast Notification */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.95 }}
            className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-2xl shadow-2xl border flex items-center gap-3 max-w-sm backdrop-blur-xl ${
              toast.type === 'success'
                ? 'bg-emerald-950/90 border-emerald-500/40 text-emerald-200'
                : toast.type === 'error'
                ? 'bg-rose-950/90 border-rose-500/40 text-rose-200'
                : 'bg-blue-950/90 border-blue-500/40 text-blue-200'
            }`}
          >
            {toast.type === 'success' && <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />}
            {toast.type === 'error' && <AlertCircle className="w-5 h-5 text-rose-400 shrink-0" />}
            {toast.type === 'info' && <Info className="w-5 h-5 text-blue-400 shrink-0" />}
            <span className="text-xs font-semibold">{toast.message}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Screen Header */}
      <div className={`px-4 sm:px-6 py-4 border-b shrink-0 flex flex-wrap items-center justify-between gap-3 ${
        isDark ? 'border-[#1E1E24] bg-black/40' : 'border-[#E2E8F0] bg-white'
      }`}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-[#0066FF] to-blue-700 flex items-center justify-center text-white shadow-lg shadow-[#0066FF]/25">
            <FileText className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base sm:text-lg font-black tracking-tight">
                Comprobantes de Pago
              </h1>
              {pendingCount > 0 && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/15 text-amber-400 border border-amber-500/30 animate-pulse">
                  {pendingCount} pendiente{pendingCount > 1 ? 's' : ''}
                </span>
              )}
            </div>
            <p className={`text-xs ${isDark ? 'text-[#8E8E93]' : 'text-[#64748B]'}`}>
              {isAdmin 
                ? 'Verificación y registro de comprobantes' 
                : 'Sube tu comprobante tras abonar por WhatsApp para activar tu VIP'}
            </p>
          </div>
        </div>

        {/* View Switcher Tabs */}
        <div className={`flex items-center p-1 rounded-2xl border text-xs font-bold ${
          isDark ? 'bg-black/40 border-[#1E1E24]' : 'bg-slate-100 border-[#E2E8F0]'
        }`}>
          <button
            onClick={() => setActiveTab('upload')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl transition-all ${
              activeTab === 'upload'
                ? 'bg-[#0066FF] text-white shadow-md shadow-[#0066FF]/30'
                : isDark ? 'text-[#8E8E93] hover:text-white' : 'text-[#64748B] hover:text-black'
            }`}
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Subir Comprobante</span>
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl transition-all ${
              activeTab === 'history'
                ? 'bg-[#0066FF] text-white shadow-md shadow-[#0066FF]/30'
                : isDark ? 'text-[#8E8E93] hover:text-white' : 'text-[#64748B] hover:text-black'
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            <span>{isAdmin ? 'Ver Todos' : 'Mis Envíos'} ({receipts.length})</span>
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 p-3 sm:p-6 max-w-4xl w-full mx-auto space-y-6">

        {/* Informative WhatsApp banner */}
        <div className={`p-4 rounded-3xl border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 transition-all ${
          isDark 
            ? 'bg-gradient-to-r from-emerald-950/20 via-black to-[#0A0A0C] border-emerald-500/20' 
            : 'bg-gradient-to-r from-emerald-50 via-white to-slate-50 border-emerald-200'
        }`}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0 border border-emerald-500/30">
              <MessageCircle className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs font-bold text-emerald-500 uppercase tracking-wider">
                Contacto Oficial de Pagos
              </p>
              <p className="text-sm font-black mt-0.5">
                WhatsApp: <span className="font-mono text-[#0066FF]">{WHATSAPP_CONTACT_PHONE}</span>
              </p>
              <p className={`text-[11px] mt-0.5 ${isDark ? 'text-[#8E8E93]' : 'text-[#64748B]'}`}>
                {isSubscribed ? (
                  <span>Tu cuenta cuenta con una <strong>membresía activa</strong> vinculada.</span>
                ) : (
                  <>Precios oficiales: <strong className="text-emerald-400">Mensual = 1$ USD</strong> | <strong className="text-emerald-400">Anual = 12$ USD</strong></>
                )}
              </p>
            </div>
          </div>

          <a
            href={`https://wa.me/${WHATSAPP_PHONE_RAW}?text=${encodeURIComponent('¡Hola! Necesito coordinar el pago de mi membresía en App 66.')}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold bg-[#25D366] text-black hover:bg-[#20ba59] transition-all shadow-md shadow-[#25D366]/20 shrink-0"
          >
            <MessageCircle className="w-4 h-4" />
            <span>Hablar por WhatsApp</span>
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>

        {/* Tab 1: Upload Form */}
        {activeTab === 'upload' && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className={`p-4 sm:p-6 rounded-3xl border shadow-2xl backdrop-blur-2xl transition-all ${
              isDark ? 'bg-zinc-950/80 border-white/[0.08] ring-1 ring-inset ring-white/[0.04]' : 'bg-white border-slate-200/90 shadow-xl ring-1 ring-inset ring-slate-100'
            }`}
          >
            <div className="border-b border-white/[0.08] dark:border-white/[0.08] pb-4 mb-5 flex items-center justify-between">
              <div>
                <h2 className="text-base font-black tracking-tight">Formulario de Envío de Comprobante</h2>
                <p className={`text-xs mt-0.5 ${isDark ? 'text-zinc-400' : 'text-[#64748B]'}`}>
                  Adjunta los datos de tu transferencia para validación y desbloqueo del contenido VIP
                </p>
              </div>
              <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-[#0066FF]/15 text-[#0066FF] border border-[#0066FF]/30">
                Paso 2 de 2
              </span>
            </div>

            <form onSubmit={handleSubmitReceipt} className="space-y-5">
              {/* Plan Selection */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider mb-2 opacity-80">
                  1. Plan Abonado
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* Plan Mensual */}
                  <div
                    onClick={() => handleSelectPlanCard('monthly')}
                    className={`p-4 rounded-2xl border cursor-pointer transition-all flex items-center justify-between relative overflow-hidden ${
                      selectedPlan === 'monthly'
                        ? 'border-[#0066FF] bg-[#0066FF]/15 ring-2 ring-[#0066FF]/30 shadow-lg shadow-[#0066FF]/10'
                        : isDark ? 'border-white/[0.08] bg-zinc-900/60 hover:border-white/20' : 'border-slate-200 bg-slate-50 hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-9 h-9 rounded-xl flex items-center justify-center font-black text-xs shadow-xs ${
                        selectedPlan === 'monthly' ? 'bg-[#0066FF] text-white shadow-[#0066FF]/40' : 'bg-black/10 dark:bg-white/10'
                      }`}>
                        1M
                      </div>
                      <div>
                        <p className="text-xs font-black">Plan Mensual</p>
                        <p className="text-[11px] text-emerald-400 font-bold">{isSubscribed ? 'Ciclo de 30 días ($1 USD/mes)' : '1$ USD al mes (30 días)'}</p>
                      </div>
                    </div>
                    {selectedPlan === 'monthly' && (
                      <CheckCircle2 className="w-5 h-5 text-[#0066FF]" />
                    )}
                  </div>

                  {/* Plan Anual */}
                  <div
                    onClick={() => handleSelectPlanCard('annual')}
                    className={`p-4 rounded-2xl border cursor-pointer transition-all flex items-center justify-between relative overflow-hidden ${
                      selectedPlan === 'annual'
                        ? 'border-amber-500 bg-amber-500/15 ring-2 ring-amber-500/30 shadow-lg shadow-amber-500/10'
                        : isDark ? 'border-white/[0.08] bg-zinc-900/60 hover:border-white/20' : 'border-slate-200 bg-slate-50 hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-xl flex items-center justify-center font-black text-xs ${
                        selectedPlan === 'annual' ? 'bg-[#0066FF] text-white' : 'bg-black/10 dark:bg-white/10'
                      }`}>
                        1A
                      </div>
                      <div>
                        <div className="flex items-center gap-1.5">
                          <p className="text-xs font-black">Plan Anual</p>
                          <span className="px-1.5 py-0.2 rounded-full text-[9px] font-extrabold bg-amber-500/20 text-amber-400 border border-amber-500/30">
                            Ahorro
                          </span>
                        </div>
                        <p className="text-[11px] text-emerald-400 font-bold">{isSubscribed ? 'Ciclo de 365 días ($12 USD/año)' : '12$ USD al año (365 días)'}</p>
                      </div>
                    </div>
                    {selectedPlan === 'annual' && (
                      <CheckCircle2 className="w-5 h-5 text-[#0066FF]" />
                    )}
                  </div>
                </div>
              </div>

              {/* Payment Method & Amount */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Method */}
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider mb-1.5 opacity-80">
                    2. Método de Pago Utilizado
                  </label>
                  <select
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value)}
                    className={`w-full px-3.5 py-2.5 rounded-xl border text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-[#0066FF] transition-all ${
                      isDark ? 'bg-black/60 border-[#1E1E24] text-white' : 'bg-white border-[#E2E8F0] text-black'
                    }`}
                  >
                    <option value="Mercado Pago">Mercado Pago (Transferencia / CVU)</option>
                    <option value="Transferencia Bancaria">Transferencia Bancaria (CBU / Alias)</option>
                    <option value="USDT / Cripto">USDT / Binance (Cripto)</option>
                    <option value="PayPal">PayPal</option>
                    <option value="Efectivo / Rapipago / Pago Fácil">Efectivo / Rapipago / Pago Fácil</option>
                    <option value="Otro">Otro medio acordado por WhatsApp</option>
                  </select>
                </div>

                {/* Amount */}
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider mb-1.5 opacity-80">
                    Monto Establecido (USD o equivalente)
                  </label>
                  <div className="relative">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 font-bold text-xs text-emerald-400">$</span>
                    <input
                      type="number"
                      step="0.5"
                      min="0.5"
                      value={amount}
                      onChange={(e) => handleAmountChange(Number(e.target.value))}
                      className={`w-full pl-8 pr-12 py-2.5 rounded-xl border text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-[#0066FF] transition-all ${
                        isDark ? 'bg-black/60 border-[#1E1E24] text-white' : 'bg-white border-[#E2E8F0] text-black'
                      }`}
                      placeholder="1"
                    />
                    <span className="absolute right-3.5 top-1/2 -translate-y-1/2 font-mono text-[10px] text-slate-400 uppercase">
                      USD
                    </span>
                  </div>

                  {/* Quick amount presets + live preview of membership that will be activated */}
                  <div className="flex items-center gap-1.5 flex-wrap mt-2">
                    {[
                      { val: 1, label: '$1 (1 Mes)' },
                      { val: 3, label: '$3 (3 Meses)' },
                      { val: 6, label: '$6 (6 Meses)' },
                      { val: 12, label: '$12 (1 Año)' },
                    ].map((preset) => (
                      <button
                        key={preset.val}
                        type="button"
                        onClick={() => handleAmountChange(preset.val)}
                        className={`px-2 py-1 rounded-lg text-[10px] font-bold border transition-all cursor-pointer ${
                          Number(amount) === preset.val
                            ? 'bg-[#0066FF] border-[#0066FF] text-white'
                            : isDark
                            ? 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10'
                            : 'bg-slate-100 border-slate-200 text-slate-700 hover:bg-slate-200'
                        }`}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                  <p className="text-[11px] font-bold text-emerald-400 mt-1.5">
                    Al aprobarse tu monto de ${resolvedUploadMembership.amount} USD se activará:{' '}
                    <span className="text-[#0066FF]">
                      {resolvedUploadMembership.planName} ({resolvedUploadMembership.durationLabel})
                    </span>
                  </p>
                </div>
              </div>

              {/* Reference Number & Contact Phone */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-bold uppercase tracking-wider opacity-80">
                      Nº de Operación / Referencia (Opcional)
                    </label>
                    <button
                      type="button"
                      onClick={handleGenerateRefCode}
                      className="text-[10px] font-bold text-[#0066FF] hover:underline cursor-pointer"
                    >
                      + Generar Código
                    </button>
                  </div>
                  <input
                    type="text"
                    value={referenceCode}
                    onChange={(e) => setReferenceCode(e.target.value)}
                    placeholder="Ej. MP-78921045 o Transf #12948"
                    className={`w-full px-3.5 py-2.5 rounded-xl border text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-[#0066FF] transition-all ${
                      isDark ? 'bg-black/60 border-[#1E1E24] text-white' : 'bg-white border-[#E2E8F0] text-black'
                    }`}
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider mb-1.5 opacity-80">
                    Tu Teléfono WhatsApp de contacto
                  </label>
                  <input
                    type="text"
                    value={whatsappPhone}
                    onChange={(e) => setWhatsappPhone(e.target.value)}
                    placeholder="Ej. +54 9 11 xxxx-xxxx"
                    className={`w-full px-3.5 py-2.5 rounded-xl border text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-[#0066FF] transition-all ${
                      isDark ? 'bg-black/60 border-[#1E1E24] text-white' : 'bg-white border-[#E2E8F0] text-black'
                    }`}
                  />
                </div>
              </div>

              {/* Voucher File Upload */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider mb-2 opacity-80">
                  3. Foto / Captura del Comprobante (Requerido)
                </label>
                
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleFileChange}
                  className="hidden"
                />

                {isCompressingImage ? (
                  <div className={`border-2 border-dashed rounded-3xl p-6 text-center transition-all flex flex-col items-center justify-center gap-2 ${
                    isDark ? 'border-[#0066FF]/40 bg-[#0066FF]/5' : 'border-blue-300 bg-blue-50/50'
                  }`}>
                    <div className="w-10 h-10 border-3 border-[#0066FF] border-t-transparent rounded-full animate-spin" />
                    <p className="text-xs font-bold text-[#0066FF] mt-1">Optimizando y procesando comprobante...</p>
                    <p className="text-[11px] text-zinc-400">Comprimiendo imagen en tiempo real para carga instantánea</p>
                  </div>
                ) : !previewImage ? (
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    className={`border-2 border-dashed rounded-3xl p-6 text-center cursor-pointer transition-all flex flex-col items-center justify-center gap-2 group ${
                      isDark 
                        ? 'border-[#2A2A34] hover:border-[#0066FF] bg-black/40 hover:bg-[#0066FF]/5' 
                        : 'border-[#CBD5E1] hover:border-[#0066FF] bg-slate-50 hover:bg-blue-50/50'
                    }`}
                  >
                    <div className="w-12 h-12 rounded-2xl bg-[#0066FF]/10 text-[#0066FF] flex items-center justify-center group-hover:scale-110 transition-transform shadow-xs">
                      <Upload className="w-6 h-6" />
                    </div>
                    <p className="text-xs font-bold mt-1">
                      Haz clic para subir o arrastrar la captura de tu pago
                    </p>
                    <p className={`text-[11px] ${isDark ? 'text-[#8E8E93]' : 'text-[#64748B]'}`}>
                      Formatos soportados: JPG, PNG, WEBP (optimización automática para móvil y web)
                    </p>
                  </div>
                ) : (
                  <div className={`p-3.5 rounded-2xl border flex items-center justify-between gap-3 shadow-sm ${
                    isDark ? 'bg-black/60 border-white/10' : 'bg-slate-50 border-slate-200'
                  }`}>
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="relative w-14 h-14 rounded-xl overflow-hidden shrink-0 border border-white/15 bg-black">
                        <img 
                          src={previewImage} 
                          alt="Previsualización de comprobante" 
                          className="w-full h-full object-cover"
                        />
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-bold truncate">{fileName || 'comprobante_captura.jpg'}</p>
                        <p className="text-[11px] text-emerald-400 font-semibold flex items-center gap-1 mt-0.5">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Comprobante listo {fileSizeKb ? `(${fileSizeKb} KB)` : ''}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-colors cursor-pointer ${
                          isDark ? 'border-white/10 hover:bg-white/10' : 'border-slate-300 hover:bg-slate-200'
                        }`}
                      >
                        Cambiar
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setPreviewImage(null);
                          setFileName('');
                          setFileSizeKb(null);
                        }}
                        className="p-1.5 text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 rounded-xl transition-colors cursor-pointer"
                        title="Quitar imagen"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Notes */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider mb-1.5 opacity-80">
                  Nota / Aclaración Adicional (Opcional)
                </label>
                <textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Ej: Transferencia enviada desde la cuenta de Juan Pérez"
                  className={`w-full px-3.5 py-2 rounded-xl border text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-[#0066FF] transition-all resize-none ${
                    isDark ? 'bg-black/60 border-[#1E1E24] text-white' : 'bg-white border-[#E2E8F0] text-black'
                  }`}
                />
              </div>

              {/* WhatsApp Notification Checkbox */}
              <label className="flex items-center gap-2.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={sendWhatsAppAlert}
                  onChange={(e) => setSendWhatsAppAlert(e.target.checked)}
                  className="rounded border-[#1E1E24] text-[#0066FF] focus:ring-0 w-4 h-4 cursor-pointer"
                />
                <span className="text-xs font-semibold">
                  Abrir WhatsApp para enviar copia al administrador (+54 9 11 6554-6038)
                </span>
              </label>

              {/* Submit Button */}
              <div className="pt-2">
                <button
                  type="submit"
                  disabled={isSubmitting || !previewImage}
                  className={`w-full py-3.5 rounded-2xl font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all cursor-pointer ${
                    !previewImage || isSubmitting
                      ? 'bg-slate-700/50 text-slate-400 cursor-not-allowed border border-white/5'
                      : 'bg-[#0066FF] hover:bg-[#0055D4] text-white shadow-xl shadow-[#0066FF]/30 hover:scale-[1.01] active:scale-[0.99]'
                  }`}
                >
                  {isSubmitting ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span>Procesando Envío...</span>
                    </>
                  ) : (
                    <>
                      <Send className="w-4 h-4" />
                      <span>Enviar Comprobante Para Validación</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </motion.div>
        )}

        {/* Tab 2: Receipts History & Verification Status (always shown on 'history' tab or below upload form when receipts exist) */}
        {(activeTab === 'history' || receipts.length > 0) && (
          <div className="space-y-4">
            {/* Header controls & Admin filters */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-black flex items-center gap-2">
                <span>{isAdmin ? 'Todos los Comprobantes Registrados' : 'Historial de Comprobantes'}</span>
                <span className="px-2 py-0.5 rounded-full text-[10px] bg-slate-500/20 text-slate-400 font-bold">
                  {displayedReceipts.length}
                </span>
              </h2>

              {/* Status Filters & Refresh */}
              <div className="flex flex-wrap items-center gap-1.5 text-xs font-bold">
                <button
                  type="button"
                  onClick={() => handleManualSyncReceipts(false)}
                  disabled={isRefreshingReceipts}
                  className={`px-2.5 py-1 rounded-xl border flex items-center gap-1 cursor-pointer transition-all ${
                    isDark
                      ? 'border-white/15 bg-white/5 hover:bg-white/10 text-white'
                      : 'border-slate-300 bg-white hover:bg-slate-100 text-slate-800'
                  }`}
                >
                  <RefreshCw className={`w-3 h-3 ${isRefreshingReceipts ? 'animate-spin text-[#0066FF]' : ''}`} />
                  <span>{isRefreshingReceipts ? 'Actualizando...' : 'Actualizar'}</span>
                </button>
                {isAdmin && onNavigateToApprovals && (
                  <button
                    type="button"
                    onClick={onNavigateToApprovals}
                    className="px-2.5 py-1 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/30 flex items-center gap-1 cursor-pointer transition-all"
                  >
                    <ShieldCheck className="w-3 h-3" />
                    <span>Ir a Aprobación de Membresías</span>
                  </button>
                )}
                <button
                  onClick={() => setStatusFilter('all')}
                  className={`px-2.5 py-1 rounded-xl transition-all ${
                    statusFilter === 'all'
                      ? 'bg-[#0066FF] text-white shadow-sm'
                      : isDark ? 'text-[#8E8E93] hover:text-white bg-black/30' : 'text-[#64748B] hover:text-black bg-slate-100'
                  }`}
                >
                  Todos
                </button>
                <button
                  onClick={() => setStatusFilter('pending')}
                  className={`px-2.5 py-1 rounded-xl transition-all flex items-center gap-1 ${
                    statusFilter === 'pending'
                      ? 'bg-amber-500 text-black shadow-sm'
                      : isDark ? 'text-amber-400/80 hover:text-amber-300 bg-amber-500/10' : 'text-amber-700 bg-amber-100'
                  }`}
                >
                  <Clock className="w-3 h-3" />
                  <span>Pendientes</span>
                </button>
                <button
                  onClick={() => setStatusFilter('approved')}
                  className={`px-2.5 py-1 rounded-xl transition-all flex items-center gap-1 ${
                    statusFilter === 'approved'
                      ? 'bg-emerald-500 text-black shadow-sm'
                      : isDark ? 'text-emerald-400/80 hover:text-emerald-300 bg-emerald-500/10' : 'text-emerald-700 bg-emerald-100'
                  }`}
                >
                  <CheckCircle2 className="w-3 h-3" />
                  <span>Aprobados</span>
                </button>
                <button
                  onClick={() => setStatusFilter('rejected')}
                  className={`px-2.5 py-1 rounded-xl transition-all flex items-center gap-1 ${
                    statusFilter === 'rejected'
                      ? 'bg-rose-500 text-white shadow-sm'
                      : isDark ? 'text-rose-400/80 hover:text-rose-300 bg-rose-500/10' : 'text-rose-700 bg-rose-100'
                  }`}
                >
                  <XCircle className="w-3 h-3" />
                  <span>Rechazados</span>
                </button>
              </div>
            </div>

            {/* List of Receipts */}
            {displayedReceipts.length === 0 ? (
              <div className={`p-8 rounded-3xl border text-center space-y-3 ${
                isDark ? 'bg-[#0E0E12] border-[#1E1E24]' : 'bg-white border-[#E2E8F0]'
              }`}>
                <div className="w-12 h-12 rounded-2xl bg-slate-500/10 text-slate-400 flex items-center justify-center mx-auto">
                  <FileText className="w-6 h-6" />
                </div>
                <h3 className="text-sm font-bold">No hay comprobantes en esta categoría</h3>
                <p className={`text-xs max-w-sm mx-auto ${isDark ? 'text-[#8E8E93]' : 'text-[#64748B]'}`}>
                  {statusFilter === 'all' 
                    ? 'Aún no se ha registrado ningún comprobante de pago. Utiliza el botón superior para subir el primero.'
                    : `No hay comprobantes con estado "${statusFilter}".`}
                </p>
                <button
                  onClick={() => setActiveTab('upload')}
                  className="px-4 py-2 rounded-xl text-xs font-bold bg-[#0066FF] text-white hover:bg-[#0055D4] transition-all shadow-md shadow-[#0066FF]/20"
                >
                  Subir Mi Comprobante
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3.5">
                {displayedReceipts.map((receipt) => {
                  const isPending = receipt.status === 'pending';
                  const isApproved = receipt.status === 'approved';
                  const isRejected = receipt.status === 'rejected';

                  return (
                    <motion.div
                      key={receipt.id}
                      layout
                      className={`p-4 rounded-3xl border transition-all ${
                        isDark ? 'bg-[#0E0E12] border-[#1E1E24]' : 'bg-white border-[#E2E8F0]'
                      } hover:border-[#0066FF]/40`}
                    >
                      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                        {/* Left: Thumbnail & Main Info */}
                        <div className="flex items-start gap-3.5 min-w-0 flex-1">
                          {/* Image preview thumb */}
                          <div 
                            onClick={() => setViewingReceipt(receipt)}
                            className="relative w-16 h-16 rounded-2xl overflow-hidden shrink-0 border border-white/10 cursor-pointer group bg-black/40"
                          >
                            <img 
                              src={receipt.receiptImageUrl} 
                              alt="Comprobante" 
                              className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-300"
                            />
                            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white">
                              <Eye className="w-4 h-4" />
                            </div>
                          </div>

                          {/* Info */}
                          <div className="min-w-0 flex-1 space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-xs font-black">
                                Plan {receipt.plan === 'monthly' ? (isSubscribed ? 'Mensual' : 'Mensual ($1 USD)') : (isSubscribed ? 'Anual' : 'Anual ($12 USD)')}
                              </span>
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border flex items-center gap-1 ${
                                isPending
                                  ? 'bg-amber-500/15 border-amber-500/30 text-amber-400 animate-pulse'
                                  : isApproved
                                  ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400'
                                  : 'bg-rose-500/15 border-rose-500/30 text-rose-400'
                              }`}>
                                {isPending && <Clock className="w-2.5 h-2.5" />}
                                {isApproved && <CheckCircle2 className="w-2.5 h-2.5" />}
                                {isRejected && <XCircle className="w-2.5 h-2.5" />}
                                <span>
                                  {isPending && 'Pendiente de verificación'}
                                  {isApproved && 'Aprobado - VIP Activo'}
                                  {isRejected && 'Rechazado'}
                                </span>
                              </span>
                            </div>

                            <p className={`text-xs ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                              Método: <strong className="text-white dark:text-white font-semibold">{receipt.paymentMethod}</strong> • Ref: <span className="font-mono text-[11px]">{receipt.referenceCode}</span>
                            </p>

                            {/* User details (for admin) */}
                            {isAdmin && (
                              <p className="text-[11px] text-slate-400 flex items-center gap-1.5">
                                <User className="w-3 h-3 text-[#0066FF]" />
                                <span>{receipt.userDisplayName} ({receipt.userEmail})</span>
                              </p>
                            )}

                            {/* Date */}
                            <p className="text-[10px] text-slate-500 font-mono">
                              Enviado: {new Date(receipt.createdAt).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })}
                            </p>

                            {/* Admin Note if any */}
                            {receipt.adminNote && (
                              <p className={`text-[11px] px-2.5 py-1 rounded-xl mt-1 border ${
                                isApproved 
                                  ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300' 
                                  : 'bg-rose-500/10 border-rose-500/20 text-rose-300'
                              }`}>
                                <strong>Nota Admin:</strong> {receipt.adminNote}
                              </p>
                            )}
                          </div>
                        </div>

                        {/* Right: Actions */}
                        <div className="flex flex-wrap sm:flex-col items-center sm:items-end gap-2 shrink-0 w-full sm:w-auto pt-2 sm:pt-0 border-t sm:border-t-0">
                          {/* Admin approval/rejection buttons */}
                          {isAdmin && (
                            <div className="flex items-center gap-1.5">
                              {!isApproved && (
                                <button
                                  onClick={() => handleApproveReceipt(receipt)}
                                  className="px-3 py-1.5 rounded-xl text-xs font-bold bg-emerald-500 text-black hover:bg-emerald-400 transition-all flex items-center gap-1 shadow-md shadow-emerald-500/20 cursor-pointer"
                                  title="Aprobar y activar VIP"
                                >
                                  <Check className="w-3.5 h-3.5" />
                                  <span>Aprobar VIP</span>
                                </button>
                              )}
                              {isPending && (
                                <button
                                  onClick={() => handleRejectReceipt(receipt)}
                                  className="px-2.5 py-1.5 rounded-xl text-xs font-bold bg-rose-500/20 text-rose-400 hover:bg-rose-500/30 transition-all cursor-pointer"
                                  title="Rechazar comprobante"
                                >
                                  <XCircle className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          )}

                          {/* Zoom Image */}
                          <button
                            onClick={() => setViewingReceipt(receipt)}
                            className={`px-3 py-1.5 rounded-xl text-xs font-semibold border flex items-center gap-1 transition-colors ${
                              isDark ? 'border-[#2A2A34] hover:bg-white/10 text-slate-300' : 'border-[#CBD5E1] hover:bg-slate-200 text-slate-700'
                            }`}
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span>Ver Comprobante</span>
                          </button>

                          {/* Direct WhatsApp check */}
                          <a
                            href={`https://wa.me/${WHATSAPP_PHONE_RAW}?text=${encodeURIComponent(
                              `Hola, consulto por mi comprobante #${receipt.id} de Plan ${receipt.plan === 'monthly' ? 'Mensual' : 'Anual'} en App 66.`
                            )}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-1.5 rounded-xl text-emerald-400 hover:bg-emerald-500/10 transition-colors"
                            title="Preguntar por WhatsApp"
                          >
                            <MessageCircle className="w-4 h-4" />
                          </a>

                          {/* Delete if pending and user created it */}
                          {(isPending || isAdmin) && (
                            <button
                              onClick={() => handleDeleteReceipt(receipt.id)}
                              className="p-1.5 text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 rounded-xl transition-colors"
                              title="Eliminar comprobante"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Lightbox Modal for Full Receipt View */}
      <AnimatePresence>
        {viewingReceipt && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-3 sm:p-6"
            onClick={() => setViewingReceipt(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className={`max-w-xl w-full rounded-3xl border shadow-2xl overflow-hidden flex flex-col max-h-[90vh] ${
                isDark ? 'bg-[#0E0E12] border-[#2A2A34] text-white' : 'bg-white border-[#E2E8F0] text-black'
              }`}
            >
              {/* Modal Header */}
              <div className="px-5 py-3.5 border-b flex items-center justify-between border-inherit">
                <div className="flex items-center gap-2.5">
                  <FileText className="w-4 h-4 text-[#0066FF]" />
                  <span className="text-xs font-black">
                    Comprobante #{viewingReceipt.id.slice(-8)}
                  </span>
                </div>
                <button
                  onClick={() => setViewingReceipt(null)}
                  className="p-1.5 rounded-xl hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
                >
                  <XCircle className="w-5 h-5" />
                </button>
              </div>

              {/* Modal Body: Image & Details */}
              <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
                {/* Full Image */}
                <div className="rounded-2xl overflow-hidden border border-white/10 bg-black/60 max-h-72 flex items-center justify-center">
                  <img
                    src={viewingReceipt.receiptImageUrl}
                    alt="Comprobante en detalle"
                    className="max-h-72 w-full object-contain"
                  />
                </div>

                {/* Details grid */}
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className={`p-3 rounded-2xl border ${isDark ? 'bg-black/40 border-[#1E1E24]' : 'bg-slate-50 border-slate-200'}`}>
                    <p className="text-[10px] text-slate-400 uppercase font-bold">Plan Solicitado</p>
                    <p className="font-black text-sm text-[#0066FF] mt-0.5">
                      {viewingReceipt.plan === 'monthly' ? (isSubscribed ? 'Mensual' : 'Mensual ($1 USD)') : (isSubscribed ? 'Anual' : 'Anual ($12 USD)')}
                    </p>
                  </div>

                  <div className={`p-3 rounded-2xl border ${isDark ? 'bg-black/40 border-[#1E1E24]' : 'bg-slate-50 border-slate-200'}`}>
                    <p className="text-[10px] text-slate-400 uppercase font-bold">Estado</p>
                    <p className={`font-black text-xs mt-0.5 uppercase ${
                      viewingReceipt.status === 'approved' 
                        ? 'text-emerald-400' 
                        : viewingReceipt.status === 'pending' 
                        ? 'text-amber-400' 
                        : 'text-rose-400'
                    }`}>
                      {viewingReceipt.status === 'approved' ? 'Aprobado - VIP Activo' : viewingReceipt.status === 'pending' ? 'Pendiente' : 'Rechazado'}
                    </p>
                  </div>

                  <div className={`p-3 rounded-2xl border ${isDark ? 'bg-black/40 border-[#1E1E24]' : 'bg-slate-50 border-slate-200'}`}>
                    <p className="text-[10px] text-slate-400 uppercase font-bold">Medio de Pago</p>
                    <p className="font-semibold text-xs mt-0.5">{viewingReceipt.paymentMethod}</p>
                  </div>

                  <div className={`p-3 rounded-2xl border ${isDark ? 'bg-black/40 border-[#1E1E24]' : 'bg-slate-50 border-slate-200'}`}>
                    <p className="text-[10px] text-slate-400 uppercase font-bold">Nº Referencia</p>
                    <p className="font-mono text-xs mt-0.5">{viewingReceipt.referenceCode}</p>
                  </div>
                </div>

                {/* User & Notes */}
                <div className={`p-3 rounded-2xl border text-xs space-y-1.5 ${
                  isDark ? 'bg-black/40 border-[#1E1E24]' : 'bg-slate-50 border-slate-200'
                }`}>
                  <p className="text-slate-400 text-[10px] uppercase font-bold">Usuario emisor</p>
                  <p className="font-bold">{viewingReceipt.userDisplayName} ({viewingReceipt.userEmail})</p>
                  {viewingReceipt.whatsappContact && (
                    <p className="text-emerald-400 text-[11px] font-mono">
                      WhatsApp emisor: {viewingReceipt.whatsappContact}
                    </p>
                  )}
                  {viewingReceipt.notes && (
                    <p className="text-slate-300 italic pt-1 border-t border-white/5">
                      "{viewingReceipt.notes}"
                    </p>
                  )}
                </div>

                {/* Admin Note if present */}
                {viewingReceipt.adminNote && (
                  <div className={`p-3 rounded-2xl border text-xs ${
                    viewingReceipt.status === 'approved' 
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' 
                      : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                  }`}>
                    <p className="font-bold text-[10px] uppercase">Nota del Administrador:</p>
                    <p className="mt-0.5">{viewingReceipt.adminNote}</p>
                  </div>
                )}
              </div>

              {/* Modal Footer */}
              <div className="p-4 border-t border-inherit flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const resp = await fetch(viewingReceipt.receiptImageUrl);
                      const blob = await resp.blob();
                      await saveFileLocallyOrDevice(blob, viewingReceipt.receiptFileName || 'comprobante.jpg', 'image/jpeg');
                    } catch (e) {
                      window.open(viewingReceipt.receiptImageUrl, '_blank');
                    }
                  }}
                  className="px-3.5 py-2 rounded-xl text-xs font-bold border border-slate-700 hover:bg-white/10 transition-colors cursor-pointer"
                >
                  Descargar Comprobante
                </button>

                {isAdmin && viewingReceipt.status === 'pending' && (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleRejectReceipt(viewingReceipt)}
                      className="px-3 py-2 rounded-xl text-xs font-bold bg-rose-500/20 text-rose-300 hover:bg-rose-500/30 transition-colors"
                    >
                      Rechazar
                    </button>
                    <button
                      onClick={() => handleApproveReceipt(viewingReceipt)}
                      className="px-4 py-2 rounded-xl text-xs font-bold bg-emerald-500 text-black hover:bg-emerald-400 transition-colors shadow-md shadow-emerald-500/20"
                    >
                      Aprobar y Activar VIP
                    </button>
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

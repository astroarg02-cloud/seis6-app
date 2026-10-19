import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Wrench,
  ShieldAlert,
  Key,
  Eye,
  EyeOff,
  AlertTriangle,
  CheckCircle2,
  ArrowRight,
  Sun,
  Moon,
  Server,
  Lock,
  Loader2,
  ShieldCheck,
  Sparkles
} from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import { isAuthorizedAdminKey, ADMIN_SECURITY_KEY } from '../data/initialVaultData';
import { firebaseService } from '../services/firebaseService';
import { UserProfile } from '../types';

interface MaintenanceScreenProps {
  onAdminLogin: (user: UserProfile) => void;
  customMessage?: string;
}

export const MaintenanceScreen: React.FC<MaintenanceScreenProps> = ({
  onAdminLogin,
  customMessage,
}) => {
  const { isDark, toggleTheme } = useTheme();
  const [adminKey, setAdminKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [showAdminPortal, setShowAdminPortal] = useState(false);

  const handleKeySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    const cleanKey = adminKey.trim();
    if (!cleanKey) {
      setErrorMessage('Por favor introduce la Key de seguridad del administrador.');
      return;
    }

    if (!isAuthorizedAdminKey(cleanKey)) {
      setErrorMessage('Key de administrador no válida. Acceso estrictamente restringido.');
      return;
    }

    setIsLoading(true);
    try {
      const adminProfile = await firebaseService.loginAsAdminWithKey(cleanKey);
      setSuccessMessage('¡Key verificada con éxito! Concediendo acceso de Administrador...');
      setTimeout(() => {
        onAdminLogin(adminProfile);
      }, 500);
    } catch (err: any) {
      setErrorMessage(err.message || 'Error al validar la Key');
      setIsLoading(false);
    }
  };

  return (
    <div
      className={`fixed inset-0 z-[99999] h-full w-full min-h-full flex flex-col items-center justify-between p-4 sm:p-6 overflow-y-auto select-none transition-colors duration-300 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] ${
        isDark
          ? 'bg-[#060608] text-white'
          : 'bg-[#F4F6FB] text-[#0F172A]'
      }`}
    >
      {/* Background ambient lighting */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none -z-10">
        <div
          className={`absolute top-[-10%] left-1/2 -translate-x-1/2 w-[600px] h-[400px] rounded-full blur-[140px] opacity-25 ${
            isDark ? 'bg-amber-500/20' : 'bg-amber-400/30'
          }`}
        />
        <div
          className={`absolute bottom-[-10%] right-[-10%] w-[450px] h-[450px] rounded-full blur-[130px] opacity-20 ${
            isDark ? 'bg-blue-600/15' : 'bg-blue-500/20'
          }`}
        />
        {/* Subtle grid pattern */}
        <div
          className="absolute inset-0 opacity-[0.03] dark:opacity-[0.05]"
          style={{
            backgroundImage: `radial-gradient(currentColor 1px, transparent 1px)`,
            backgroundSize: '24px 24px',
          }}
        />
      </div>

      {/* Top Bar with Brand and Theme toggle */}
      <header className="w-full max-w-4xl flex items-center justify-between shrink-0 py-2">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-amber-500/20 border border-amber-500/30 text-amber-500 flex items-center justify-center font-black text-sm shadow-sm">
            <Wrench className="w-4 h-4 animate-spin [animation-duration:8s]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-black tracking-tight leading-none">
                App 66
              </span>
              <span className="px-2 py-0.5 rounded-full text-[9px] font-extrabold uppercase bg-amber-500/15 text-amber-500 dark:text-amber-400 border border-amber-500/30">
                SISTEMA EN MANTENIMIENTO
              </span>
            </div>
            <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
              Servidor Privado & Bóveda Exclusiva
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={toggleTheme}
            className={`p-2 rounded-xl border transition-all cursor-pointer ${
              isDark
                ? 'bg-[#121217] border-[#22222B] text-slate-300 hover:text-white hover:bg-[#1A1A22]'
                : 'bg-white border-slate-200 text-slate-600 hover:text-black hover:bg-slate-50 shadow-sm'
            }`}
            title="Cambiar tema"
          >
            {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
        </div>
      </header>

      {/* Center Main Maintenance Notice Card */}
      <main className="w-full max-w-lg my-auto py-6 flex flex-col items-center">
        <motion.div
          initial={{ opacity: 0, scale: 0.94, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 350, damping: 28 }}
          className={`w-full rounded-3xl border p-6 sm:p-8 flex flex-col items-center text-center shadow-2xl relative overflow-hidden backdrop-blur-xl ${
            isDark
              ? 'bg-[#0E0E13]/90 border-amber-500/25 shadow-black/80'
              : 'bg-white/95 border-amber-300/60 shadow-xl'
          }`}
        >
          {/* Top amber accent line */}
          <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-amber-500/0 via-amber-500 to-amber-500/0" />

          {/* Main Animated Icon */}
          <div className="relative mb-5 mt-1">
            <motion.div
              animate={{ rotate: [0, 10, -10, 0] }}
              transition={{ repeat: Infinity, duration: 4, ease: 'easeInOut' }}
              className="w-20 h-20 rounded-3xl bg-amber-500/15 border-2 border-amber-500/30 flex items-center justify-center text-amber-500 dark:text-amber-400 shadow-xl shadow-amber-500/15"
            >
              <Wrench className="w-10 h-10" />
            </motion.div>
            <div className="absolute -bottom-1.5 -right-1.5 w-7 h-7 rounded-xl bg-red-500 text-white flex items-center justify-center border-2 border-white dark:border-[#0E0E13] shadow-md">
              <Lock className="w-3.5 h-3.5" />
            </div>
          </div>

          {/* Live pulsing status badge */}
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/25 mb-3">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500" />
            </span>
            <span>Mantenimiento Activo</span>
          </div>

          {/* Title */}
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight mb-2">
            Sitio en Mantenimiento
          </h1>

          {/* Description */}
          <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 max-w-sm leading-relaxed mb-6">
            {customMessage ||
              'Actualmente estamos optimizando y realizando mejoras técnicas en el servidor privado de la bóveda. El acceso para visitantes y miembros se encuentra temporalmente bloqueado.'}
          </p>

          {/* Security Banner: No viewing or actions allowed for regular users */}
          <div className={`w-full p-3.5 rounded-2xl border text-left flex items-start gap-3 mb-5 ${
            isDark
              ? 'bg-[#15151C] border-[#22222E] text-slate-400'
              : 'bg-slate-50 border-slate-200 text-slate-600'
          }`}>
            <ShieldAlert className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
            <div className="text-xs leading-relaxed">
              <span className="font-bold text-slate-900 dark:text-slate-100 block mb-0.5">
                Acceso restringido temporalmente
              </span>
              Estamos realizando mejoras en la bóveda. El servicio volverá a estar disponible en breve.
            </div>
          </div>

          {/* Admin Portal Toggle */}
          <div className="w-full pt-2 border-t border-slate-200 dark:border-white/10">
            {!showAdminPortal ? (
              <button
                type="button"
                onClick={() => setShowAdminPortal(true)}
                className="inline-flex items-center gap-1.5 text-xs font-bold text-[#0066FF] hover:underline cursor-pointer py-1"
              >
                <Key className="w-3.5 h-3.5" />
                <span>Acceso Administrador</span>
              </button>
            ) : (
              <form onSubmit={handleKeySubmit} className="space-y-2.5 text-left mt-2">
                {errorMessage && (
                  <div className="p-2.5 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-xs flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span>{errorMessage}</span>
                  </div>
                )}
                {successMessage && (
                  <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span>{successMessage}</span>
                  </div>
                )}
                <div className="relative">
                  <Key className="w-4 h-4 absolute left-3.5 top-2.5 text-[#0066FF]" />
                  <input
                    type={showKey ? 'text' : 'password'}
                    value={adminKey}
                    onChange={(e) => setAdminKey(e.target.value)}
                    placeholder="Key de Administrador..."
                    className={`w-full pl-10 pr-10 py-2 rounded-xl text-xs border focus:outline-none focus:border-[#0066FF] font-mono ${
                      isDark
                        ? 'bg-[#121218] border-[#252532] text-white'
                        : 'bg-white border-slate-300 text-slate-900'
                    }`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey(!showKey)}
                    className="absolute right-3 top-2.5 text-slate-400 hover:text-white cursor-pointer"
                  >
                    {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full py-2.5 rounded-xl bg-[#0066FF] hover:bg-[#0052FF] text-white text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer shadow-md"
                >
                  {isLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <>
                      <ShieldCheck className="w-4 h-4" />
                      <span>Entrar como Administrador</span>
                    </>
                  )}
                </button>
              </form>
            )}
          </div>
        </motion.div>
      </main>

      {/* Footer info */}
      <footer className="w-full max-w-4xl flex flex-col sm:flex-row items-center justify-between gap-2 py-3 text-[11px] text-slate-500 dark:text-slate-400 border-t border-slate-200 dark:border-white/5 shrink-0">
        <div className="flex items-center gap-2">
          <Server className="w-3.5 h-3.5 text-amber-500" />
          <span>Servidor Privado App 66 &bull; Seguridad Reforzada</span>
        </div>
        <div className="flex items-center gap-3">
          <span>Bóveda Privada</span>
        </div>
      </footer>
    </div>
  );
};

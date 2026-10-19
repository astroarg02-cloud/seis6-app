import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Lock,
  CheckCircle2,
  AlertCircle,
  Shield,
  Flame,
  UserPlus,
  LogIn,
  Mail,
  User,
  Eye,
  EyeOff,
  Key,
  ArrowLeft,
  Crown,
  Sparkles,
  ShieldCheck
} from 'lucide-react';
import { UserProfile } from '../../types';
import { useTheme } from '../../context/ThemeContext';
import { firebaseService } from '../../services/firebaseService';
import { isAuthorizedAdminKey } from '../../data/initialVaultData';

interface AuthScreenProps {
  onLogin: (user: UserProfile) => void;
}

export const AuthScreen: React.FC<AuthScreenProps> = ({ onLogin }) => {
  const [isSignUp, setIsSignUp] = useState(false);
  const [isAdminMode, setIsAdminMode] = useState(false);
  const [adminKey, setAdminKey] = useState('');
  const [showAdminKey, setShowAdminKey] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const { isDark } = useTheme();

  useEffect(() => {
    firebaseService.syncAllRegisteredAccountsToDatabase().catch(() => {});
  }, []);

  const handleAdminKeySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    const cleanKey = adminKey.trim();
    if (!cleanKey) {
      setErrorMessage('Por favor introduce la Key de Administrador.');
      return;
    }

    if (!isAuthorizedAdminKey(cleanKey)) {
      setErrorMessage('Key de Administrador incorrecta. Acceso denegado.');
      return;
    }

    setIsLoading(true);
    try {
      const adminUser = await firebaseService.loginAsAdminWithKey(cleanKey);
      setSuccessMessage('¡Acceso de Administrador verificado!');
      setTimeout(() => {
        onLogin(adminUser);
      }, 350);
    } catch (err: any) {
      setErrorMessage(err?.message || 'Error al verificar acceso de Administrador.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    const cleanEmail = email.trim();
    const cleanPass = password.trim();

    if (!cleanEmail || !cleanPass) {
      setErrorMessage('Por favor ingresa tu correo electrónico y contraseña.');
      return;
    }

    if (isSignUp && cleanPass.length < 6) {
      setErrorMessage('La contraseña debe contener al menos 6 caracteres.');
      return;
    }

    setIsLoading(true);

    try {
      let user: UserProfile;
      if (isSignUp) {
        user = await firebaseService.registerWithEmail(cleanEmail, cleanPass, displayName.trim() || undefined);
        setSuccessMessage('¡Cuenta creada y registrada con éxito!');
      } else {
        user = await firebaseService.signInWithEmail(cleanEmail, cleanPass);
        setSuccessMessage('¡Sesión iniciada con éxito!');
      }

      setTimeout(() => {
        onLogin(user);
      }, 400);
    } catch (err: any) {
      let friendlyMsg = 'No se pudo completar la autenticación.';
      const code = err?.code || '';

      if (code === 'auth/user-not-found') {
        friendlyMsg = 'Esta cuenta no está registrada. Selecciona la pestaña "Registrarse" para crearla.';
      } else if (code === 'auth/invalid-credential' || code === 'auth/wrong-password') {
        friendlyMsg = 'Correo o contraseña incorrectos. Verifica tus datos o regístrate si eres nuevo.';
      } else if (code === 'auth/email-already-in-use') {
        friendlyMsg = 'Este correo ya está registrado. Selecciona "Iniciar Sesión".';
      } else if (code === 'auth/weak-password') {
        friendlyMsg = 'La contraseña es muy débil. Debe tener al menos 6 caracteres.';
      } else if (code === 'auth/invalid-email') {
        friendlyMsg = 'El formato del correo electrónico es inválido.';
      } else if (code === 'auth/network-request-failed') {
        friendlyMsg = 'Error de conexión. Intenta de nuevo.';
      } else if (err?.message) {
        friendlyMsg = err.message;
      }
      setErrorMessage(friendlyMsg);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.25 }}
      className={`h-full w-full min-h-full flex-1 flex flex-col justify-between p-4 sm:p-6 select-none overflow-y-auto custom-scrollbar transition-colors duration-300 pt-[max(1.25rem,env(safe-area-inset-top))] pb-[max(1.25rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] ${
        isDark ? 'bg-[#050507] text-white' : 'bg-[#F8FAFC] text-[#0F172A]'
      }`}
    >
      <div className="relative w-full max-w-sm sm:max-w-md mx-auto my-auto p-6 sm:p-8 rounded-3xl border shadow-2xl backdrop-blur-3xl transition-all space-y-5 border-white/[0.08] bg-zinc-950/85 ring-1 ring-inset ring-white/[0.05]">
        {/* Ambient glow behind emblem */}
        <div className="absolute top-10 left-1/2 -translate-x-1/2 w-56 h-56 bg-[#0066FF]/15 rounded-full blur-3xl pointer-events-none" />

        {/* Vault Emblem & Branding */}
        <div className="flex flex-col items-center text-center space-y-3 relative z-10">
          <motion.div 
            className="relative"
            animate={{ y: [0, -4, 0] }}
            transition={{ repeat: Infinity, duration: 4.5, ease: "easeInOut" }}
          >
            <div
              className={`w-18 h-18 rounded-3xl flex items-center justify-center border transition-all ${
                isDark
                  ? 'bg-zinc-900/90 border-white/10 shadow-[0_0_50px_-10px_rgba(0,102,255,0.45)]'
                  : 'bg-white border-blue-100 shadow-xl shadow-blue-500/15'
              }`}
            >
              <Shield className="w-9 h-9 text-[#0066FF]" />
            </div>
            <div className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-[#0066FF] flex items-center justify-center shadow-md shadow-[#0066FF]/40 border border-white/20">
              <Key className="w-2.5 h-2.5 text-white" />
            </div>
          </motion.div>

          <div>
            <div className="inline-flex items-center justify-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#0066FF]/10 border border-[#0066FF]/30 text-[10px] font-extrabold tracking-widest text-[#0066FF] uppercase mb-1">
              <Sparkles className="w-2.5 h-2.5" />
              <span>BÓVEDA PRIVADA</span>
            </div>
            <h1 className={`text-2xl font-black tracking-tight ${isDark ? 'text-white' : 'text-[#0F172A]'}`}>
              {isAdminMode
                ? 'Acceso Administrador'
                : isSignUp
                ? 'Crear Cuenta'
                : 'Acceso al Servidor'}
            </h1>
            <p className={`text-xs max-w-xs mt-1 leading-relaxed ${isDark ? 'text-zinc-400' : 'text-slate-500'}`}>
              {isAdminMode
                ? 'Ingresa la Key de seguridad para gestionar comprobantes y miembros.'
                : isSignUp
                ? 'Registra tu perfil para acceder al contenido y servicios de la bóveda.'
                : 'Ingresa con tu correo y contraseña para acceder.'}
            </p>
          </div>
        </div>

        {/* Error Alert */}
        <AnimatePresence>
          {errorMessage && (
            <motion.div 
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              className="p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-start gap-2.5"
            >
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
              <span className="leading-relaxed">{errorMessage}</span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Success Alert */}
        <AnimatePresence>
          {successMessage && (
            <motion.div 
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              className="p-3.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-start gap-2.5"
            >
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-400" />
              <span className="leading-relaxed">{successMessage}</span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Mode Toggle: Modo Administrador con Key */}
        <div
          className={`p-3.5 rounded-2xl border flex items-center justify-between transition-colors ${
            isAdminMode
              ? 'bg-[#0066FF]/10 border-[#0066FF]/40 ring-1 ring-inset ring-[#0066FF]/20'
              : isDark
              ? 'bg-zinc-900/60 border-white/[0.06]'
              : 'bg-slate-50 border-slate-200'
          }`}
        >
          <div className="flex items-center gap-3">
            <div
              className={`w-8 h-8 rounded-xl flex items-center justify-center transition-colors ${
                isAdminMode
                  ? 'bg-[#0066FF] text-white shadow-md shadow-[#0066FF]/40'
                  : isDark
                  ? 'bg-zinc-800 text-[#0066FF]'
                  : 'bg-white text-[#0066FF] border border-slate-200'
              }`}
            >
              <Key className="w-4 h-4" />
            </div>
            <div>
              <div className={`text-xs font-bold ${isDark ? 'text-white' : 'text-[#0F172A]'}`}>
                Modo Administrador
              </div>
              <div className={`text-[10px] ${isDark ? 'text-zinc-400' : 'text-slate-500'}`}>
                Acceso con Key de seguridad
              </div>
            </div>
          </div>

          <button
            type="button"
            id="toggle-admin-mode-btn"
            onClick={() => {
              setIsAdminMode(!isAdminMode);
              setErrorMessage(null);
              setSuccessMessage(null);
            }}
            className={`w-11 h-6 rounded-full p-0.5 transition-colors cursor-pointer relative ${
              isAdminMode ? 'bg-[#0066FF]' : isDark ? 'bg-zinc-800' : 'bg-slate-300'
            }`}
          >
            <div
              className={`w-5 h-5 rounded-full bg-white shadow-md transition-transform ${
                isAdminMode ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>

        {isAdminMode ? (
          /* Formulario de Acceso Administrador con Key */
          <form onSubmit={handleAdminKeySubmit} className="space-y-3.5">
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1.5">
                Key de Administrador
              </label>
              <div className="relative">
                <Key className="w-4 h-4 absolute left-3.5 top-3 text-[#0066FF]" />
                <input
                  type={showAdminKey ? 'text' : 'password'}
                  required
                  value={adminKey}
                  onChange={(e) => setAdminKey(e.target.value)}
                  placeholder="Ingresa la Key de seguridad..."
                  className={`w-full pl-10 pr-10 py-2.5 rounded-xl text-xs sm:text-sm border focus:outline-none focus:border-[#0066FF] focus:ring-1 focus:ring-[#0066FF] transition-all font-mono ${
                    isDark
                      ? 'bg-black/60 border-white/[0.08] text-white placeholder-zinc-600'
                      : 'bg-white border-slate-200 text-slate-900 placeholder-slate-400'
                  }`}
                />
                <button
                  type="button"
                  onClick={() => setShowAdminKey(!showAdminKey)}
                  className="absolute right-3.5 top-3 text-zinc-400 hover:text-white cursor-pointer"
                >
                  {showAdminKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <motion.button
              type="submit"
              disabled={isLoading}
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.98 }}
              className="w-full py-3 px-4 rounded-xl bg-[#0066FF] hover:bg-blue-600 text-white font-bold text-xs sm:text-sm uppercase tracking-wide flex items-center justify-center gap-2 shadow-lg shadow-[#0066FF]/30 transition-all cursor-pointer disabled:opacity-50"
            >
              {isLoading ? (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <>
                  <ShieldCheck className="w-4 h-4" />
                  <span>Entrar como Administrador</span>
                </>
              )}
            </motion.button>

            <button
              type="button"
              onClick={() => {
                setIsAdminMode(false);
                setErrorMessage(null);
              }}
              className={`w-full py-2 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer ${
                isDark ? 'text-zinc-400 hover:text-white' : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Volver a Inicio de Sesión de Usuarios</span>
            </button>
          </form>
        ) : (
          /* Formulario Normal de Auth (Login y Registro) */
          <div className="space-y-3.5">
            {/* Tab Toggle: Iniciar Sesión / Registrarse */}
            <div className={`p-1 rounded-2xl flex border relative ${
              isDark ? 'bg-zinc-900/80 border-white/[0.06]' : 'bg-slate-100 border-slate-200'
            }`}>
              <button
                type="button"
                onClick={() => {
                  setIsSignUp(false);
                  setErrorMessage(null);
                  setSuccessMessage(null);
                }}
                className={`relative flex-1 py-2 text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 transition-colors cursor-pointer select-none ${
                  !isSignUp ? 'text-white' : isDark ? 'text-zinc-400 hover:text-white' : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                {!isSignUp && (
                  <motion.div
                    layoutId="active-auth-tab-pill"
                    className="absolute inset-0 rounded-xl bg-[#0066FF] shadow-md shadow-[#0066FF]/40"
                    transition={{ type: "spring", stiffness: 450, damping: 32 }}
                  />
                )}
                <LogIn className="relative z-10 w-3.5 h-3.5" />
                <span className="relative z-10">Iniciar Sesión</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsSignUp(true);
                  setErrorMessage(null);
                  setSuccessMessage(null);
                }}
                className={`relative flex-1 py-2 text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 transition-colors cursor-pointer select-none ${
                  isSignUp ? 'text-white' : isDark ? 'text-zinc-400 hover:text-white' : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                {isSignUp && (
                  <motion.div
                    layoutId="active-auth-tab-pill"
                    className="absolute inset-0 rounded-xl bg-[#0066FF] shadow-md shadow-[#0066FF]/40"
                    transition={{ type: "spring", stiffness: 450, damping: 32 }}
                  />
                )}
                <UserPlus className="relative z-10 w-3.5 h-3.5" />
                <span className="relative z-10">Registrarse</span>
              </button>
            </div>

            {/* Formulario */}
            <form onSubmit={handleSubmit} className="space-y-3">
              <AnimatePresence>
                {isSignUp && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                  >
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1">
                      Nombre o Apodo
                    </label>
                    <div className="relative">
                      <User className="w-4 h-4 absolute left-3.5 top-3 text-zinc-400" />
                      <input
                        type="text"
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        placeholder="Tu nombre o alias"
                        className={`w-full pl-10 pr-3 py-2.5 rounded-xl text-xs sm:text-sm border focus:outline-none focus:border-[#0066FF] focus:ring-1 focus:ring-[#0066FF] transition-all ${
                          isDark
                            ? 'bg-black/60 border-white/[0.08] text-white placeholder-zinc-600'
                            : 'bg-white border-slate-200 text-slate-900 placeholder-slate-400'
                        }`}
                      />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1">
                  Correo Electrónico
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 absolute left-3.5 top-3 text-zinc-400" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="usuario@ejemplo.com"
                    className={`w-full pl-10 pr-3 py-2.5 rounded-xl text-xs sm:text-sm border focus:outline-none focus:border-[#0066FF] focus:ring-1 focus:ring-[#0066FF] transition-all ${
                      isDark
                        ? 'bg-black/60 border-white/[0.08] text-white placeholder-zinc-600'
                        : 'bg-white border-slate-200 text-slate-900 placeholder-slate-400'
                    }`}
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1">
                  Contraseña
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 absolute left-3.5 top-3 text-zinc-400" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Mínimo 6 caracteres"
                    className={`w-full pl-10 pr-10 py-2.5 rounded-xl text-xs sm:text-sm border focus:outline-none focus:border-[#0066FF] focus:ring-1 focus:ring-[#0066FF] transition-all ${
                      isDark
                        ? 'bg-black/60 border-white/[0.08] text-white placeholder-zinc-600'
                        : 'bg-white border-slate-200 text-slate-900 placeholder-slate-400'
                    }`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3.5 top-3 text-zinc-400 hover:text-white cursor-pointer"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <motion.button
                type="submit"
                disabled={isLoading}
                whileHover={{ scale: 1.01 }}
                whileTap={{ scale: 0.98 }}
                className="w-full py-3 px-4 rounded-xl bg-[#0066FF] hover:bg-blue-600 text-white font-bold text-xs sm:text-sm uppercase tracking-wide flex items-center justify-center gap-2 shadow-lg shadow-[#0066FF]/30 transition-all cursor-pointer disabled:opacity-50 mt-2"
              >
                {isLoading ? (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <>
                    <Shield className="w-4 h-4" />
                    <span>{isSignUp ? 'Crear Cuenta' : 'Iniciar Sesión'}</span>
                  </>
                )}
              </motion.button>
            </form>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className={`w-full max-w-sm sm:max-w-md mx-auto pt-4 text-center border-t ${
        isDark ? 'border-white/[0.06]' : 'border-slate-200'
      }`}>
        <span
          className={`text-[10px] uppercase tracking-widest font-mono flex items-center justify-center gap-1.5 ${
            isDark ? 'text-zinc-500' : 'text-slate-400'
          }`}
        >
          <Flame className="w-3 h-3 text-amber-500" />
          BÓVEDA PRIVADA & FIREBASE AUTH
        </span>
      </div>
    </motion.div>
  );
};

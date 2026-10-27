import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Sparkles,
  X,
  CheckCircle2,
  AlertCircle,
  Radio,
  RefreshCw,
  Globe,
  Wifi,
  Smartphone,
  ExternalLink,
  ShieldCheck,
  Send,
  Zap,
  Layers,
  ArrowRight
} from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import { liveSyncService, DEFAULT_OFFICIAL_LIVE_URL, LiveSyncConfig } from '../services/liveSyncService';
import { UserProfile } from '../types';

interface AdminLiveSyncModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: UserProfile | null;
}

export const AdminLiveSyncModal: React.FC<AdminLiveSyncModalProps> = ({
  isOpen,
  onClose,
  currentUser,
}) => {
  const { isDark } = useTheme();
  const [liveUrl, setLiveUrl] = useState<string>(() => liveSyncService.getLiveServerUrl());
  const [isEnabled, setIsEnabled] = useState<boolean>(() => liveSyncService.isLiveSyncEnabled());
  const [isCurrentlyLive, setIsCurrentlyLive] = useState<boolean>(() => liveSyncService.isCurrentlyOnLiveServer());
  const [isLocalStandalone, setIsLocalStandalone] = useState<boolean>(() => liveSyncService.isLocalStandalone());
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ reachable: boolean; latencyMs: number; error?: string } | null>(null);
  const [isBroadcasting, setIsBroadcasting] = useState(false);
  const [broadcastFeedback, setBroadcastFeedback] = useState<string | null>(null);
  const [cloudConfig, setCloudConfig] = useState<LiveSyncConfig | null>(null);

  useEffect(() => {
    if (isOpen) {
      setLiveUrl(liveSyncService.getLiveServerUrl());
      setIsEnabled(liveSyncService.isLiveSyncEnabled());
      setIsCurrentlyLive(liveSyncService.isCurrentlyOnLiveServer());
      setIsLocalStandalone(liveSyncService.isLocalStandalone());
      setTestResult(null);
      setBroadcastFeedback(null);

      liveSyncService.fetchLiveSyncCloudConfig().then((cfg) => {
        if (cfg) {
          setCloudConfig(cfg);
          if (cfg.liveServerUrl) setLiveUrl(cfg.liveServerUrl);
          if (cfg.enabled !== undefined) setIsEnabled(cfg.enabled);
        }
      });
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const res = await liveSyncService.probeLiveServer(liveUrl, 3000);
      setTestResult(res);
    } finally {
      setIsTesting(false);
    }
  };

  const handleResetToDefault = () => {
    setLiveUrl(DEFAULT_OFFICIAL_LIVE_URL);
    setTestResult(null);
  };

  const handleBroadcastUpdate = async () => {
    setIsBroadcasting(true);
    setBroadcastFeedback(null);
    try {
      const newRefreshId = `ota-sync-${Date.now()}`;
      const ok = await liveSyncService.publishLiveSyncCloudConfig(
        {
          liveServerUrl: liveUrl.trim(),
          enabled: isEnabled,
          forceRefreshId: newRefreshId,
          version: '1.0.2',
          notes: 'Actualización en vivo solicitada por el administrador',
        },
        currentUser?.email
      );

      if (ok) {
        setBroadcastFeedback('¡Señal de actualización emitida con éxito a todos los dispositivos!');
        // Refresh local cloud config representation
        const fresh = await liveSyncService.fetchLiveSyncCloudConfig();
        if (fresh) setCloudConfig(fresh);
      } else {
        setBroadcastFeedback('No se pudo enviar la señal a Firebase. Verifica la conexión.');
      }
    } catch (err: any) {
      setBroadcastFeedback('Error al emitir actualización: ' + (err?.message || 'Error'));
    } finally {
      setIsBroadcasting(false);
    }
  };

  const handleSaveConfig = async () => {
    liveSyncService.setLiveServerUrl(liveUrl);
    liveSyncService.setLiveSyncEnabled(isEnabled);
    await handleBroadcastUpdate();
    onClose();
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[100000] flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-md">
        <motion.div
          initial={{ opacity: 0, scale: 0.94, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.94, y: 15 }}
          transition={{ type: 'spring', damping: 25, stiffness: 350 }}
          className={`w-full max-w-lg rounded-3xl border shadow-2xl overflow-hidden flex flex-col max-h-[90dvh] ${
            isDark ? 'bg-[#0B0C10] border-white/10 text-white' : 'bg-white border-slate-200 text-slate-900'
          }`}
        >
          {/* Header */}
          <div className="p-4 sm:p-5 border-b border-white/[0.08] flex items-center justify-between shrink-0 bg-gradient-to-r from-blue-600/10 via-purple-600/5 to-transparent">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-[#0066FF] to-blue-700 flex items-center justify-center text-white shadow-lg shadow-[#0066FF]/30 shrink-0">
                <Radio className="w-5 h-5 animate-pulse text-white" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-black tracking-tight">Actualizaciones en Vivo (OTA)</h2>
                  <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                    LIVE SYNC
                  </span>
                </div>
                <p className={`text-xs ${isDark ? 'text-zinc-400' : 'text-slate-500'}`}>
                  Refleja cambios en la app compilada en móviles sin reinstalar
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className={`p-2 rounded-xl border transition-colors cursor-pointer shrink-0 ${
                isDark ? 'border-white/10 hover:bg-white/10 text-zinc-400 hover:text-white' : 'border-slate-200 hover:bg-slate-100 text-slate-500 hover:text-slate-900'
              }`}
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Modal Body */}
          <div className="p-4 sm:p-6 overflow-y-auto custom-scrollbar space-y-5 flex-1 min-h-0 text-xs">
            {/* Realtime Environment Status Banner */}
            <div
              className={`p-4 rounded-2xl border transition-all ${
                isCurrentlyLive
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                  : isLocalStandalone
                  ? 'bg-blue-500/10 border-blue-500/30 text-blue-400'
                  : 'bg-zinc-500/10 border-zinc-500/30 text-zinc-400'
              }`}
            >
              <div className="flex items-center gap-3">
                <div
                  className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                    isCurrentlyLive ? 'bg-emerald-500/20 text-emerald-400' : 'bg-blue-500/20 text-blue-400'
                  }`}
                >
                  {isCurrentlyLive ? <Globe className="w-5 h-5" /> : <Smartphone className="w-5 h-5" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm">
                      {isCurrentlyLive
                        ? 'Ejecutando en Modo En Vivo (Cloud OTA)'
                        : isLocalStandalone
                        ? 'Ejecutando en Modo Local (APK / IPA Nativo)'
                        : 'Ejecutando en Servidor Web'}
                    </span>
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                    </span>
                  </div>
                  <p className="text-[11px] opacity-80 mt-0.5 leading-relaxed">
                    {isCurrentlyLive
                      ? 'La app está cargando directamente desde el servidor en vivo. Todas las modificaciones se visualizan al instante.'
                      : 'La app está en el contenedor móvil local y transferirá automáticamente la vista al servidor en vivo cuando esté disponible.'}
                  </p>
                </div>
              </div>
            </div>

            {/* Toggle Switch */}
            <div
              className={`p-4 rounded-2xl border flex items-center justify-between ${
                isDark ? 'bg-zinc-900/60 border-white/[0.08]' : 'bg-slate-50 border-slate-200'
              }`}
            >
              <div className="space-y-0.5 max-w-[80%]">
                <div className="font-bold text-xs flex items-center gap-1.5">
                  <Zap className="w-3.5 h-3.5 text-amber-400" />
                  <span>Sincronización Automática en Móviles</span>
                </div>
                <p className={`text-[11px] ${isDark ? 'text-zinc-400' : 'text-slate-500'}`}>
                  Permite que la app compilada en teléfonos móviles se conecte al servidor remoto al abrirse.
                </p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer shrink-0">
                <input
                  type="checkbox"
                  checked={isEnabled}
                  onChange={(e) => setIsEnabled(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-zinc-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#0066FF]" />
              </label>
            </div>

            {/* Remote Live Server URL input */}
            <div className="space-y-2">
              <label className="block text-xs font-bold flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <Globe className="w-3.5 h-3.5 text-[#0066FF]" />
                  <span>URL del Servidor en Vivo (Producción / GitHub Pages):</span>
                </span>
                <button
                  type="button"
                  onClick={handleResetToDefault}
                  className="text-[10px] text-[#0066FF] hover:underline font-semibold cursor-pointer"
                >
                  Restablecer Oficial
                </button>
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="url"
                  value={liveUrl}
                  onChange={(e) => setLiveUrl(e.target.value)}
                  placeholder="https://astroarg02-cloud.github.io/seis6-app/"
                  className={`flex-1 px-3.5 py-2.5 rounded-xl border text-xs font-mono transition-colors outline-none focus:ring-2 focus:ring-[#0066FF] ${
                    isDark ? 'bg-zinc-900/90 border-white/10 text-white' : 'bg-white border-slate-200 text-slate-900'
                  }`}
                />
                <button
                  type="button"
                  onClick={handleTestConnection}
                  disabled={isTesting || !liveUrl}
                  className="px-3 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold text-xs transition-colors cursor-pointer flex items-center gap-1.5 shrink-0"
                >
                  <Wifi className={`w-3.5 h-3.5 ${isTesting ? 'animate-spin' : ''}`} />
                  <span>{isTesting ? 'Probando...' : 'Probar'}</span>
                </button>
              </div>

              {/* Test Result Feedback */}
              {testResult && (
                <div
                  className={`p-3 rounded-xl border flex items-center gap-2 text-xs ${
                    testResult.reachable
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                      : 'bg-rose-500/10 border-rose-500/30 text-rose-400'
                  }`}
                >
                  {testResult.reachable ? (
                    <>
                      <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
                      <span>
                        Servidor en línea y accesible ({testResult.latencyMs} ms). Compatible con OTA Live Updates.
                      </span>
                    </>
                  ) : (
                    <>
                      <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                      <span>No se pudo conectar: {testResult.error || 'Servidor inaccesible'}</span>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Broadcast Force Reload Section */}
            <div
              className={`p-4 rounded-2xl border space-y-3 ${
                isDark ? 'bg-zinc-900/40 border-white/[0.08]' : 'bg-slate-50 border-slate-200'
              }`}
            >
              <div className="flex items-center gap-2 font-bold text-xs">
                <RefreshCw className="w-4 h-4 text-emerald-400" />
                <span>Forzar Sincronización Inmediata en Dispositivos</span>
              </div>
              <p className={`text-[11px] leading-relaxed ${isDark ? 'text-zinc-400' : 'text-slate-500'}`}>
                Envía una señal global vía Firebase para invalidar la caché de todos los usuarios que tengan la app abierta en Android, iOS o navegador, forzando la recarga en vivo de la última versión.
              </p>

              <button
                type="button"
                onClick={handleBroadcastUpdate}
                disabled={isBroadcasting}
                className="w-full py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-xs transition-all shadow-lg shadow-emerald-600/20 cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <Send className={`w-3.5 h-3.5 ${isBroadcasting ? 'animate-spin' : ''}`} />
                <span>{isBroadcasting ? 'Emitiendo señal en la nube...' : 'Emitir Señal de Actualización Instantánea'}</span>
              </button>

              {broadcastFeedback && (
                <div className="p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-semibold flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>{broadcastFeedback}</span>
                </div>
              )}
            </div>

            {/* Explanation Guide */}
            <div
              className={`p-4 rounded-2xl border space-y-2 text-[11px] ${
                isDark ? 'bg-white/[0.02] border-white/[0.06] text-zinc-400' : 'bg-slate-100 border-slate-200 text-slate-600'
              }`}
            >
              <div className="font-bold text-xs flex items-center gap-1.5 text-white">
                <Layers className="w-3.5 h-3.5 text-[#0066FF]" />
                <span>¿Cómo funciona el sistema en la app compilada?</span>
              </div>
              <ul className="space-y-1.5 list-disc list-inside">
                <li>
                  <strong className="text-white">Capacitor Native Bridge:</strong> La APK o IPA apunta a tu servidor en vivo con soporte de navegación interna.
                </li>
                <li>
                  <strong className="text-white">Hot-Reload OTA:</strong> Al hacer push a GitHub, GitHub Actions compila y despliega en GitHub Pages en 60 segundos.
                </li>
                <li>
                  <strong className="text-white">Sin reinstalar:</strong> Tu teléfono abre automáticamente los archivos web actualizados sin descargar un nuevo archivo instalador.
                </li>
                <li>
                  <strong className="text-white">Modo Offline Seguro:</strong> Si el teléfono no tiene conexión a internet, la app sigue funcionando con el paquete local integrado.
                </li>
              </ul>
            </div>
          </div>

          {/* Footer Controls */}
          <div className="p-4 sm:p-5 border-t border-white/[0.08] flex items-center justify-end gap-3 shrink-0 bg-black/20">
            <button
              type="button"
              onClick={onClose}
              className={`px-4 py-2.5 rounded-xl border text-xs font-bold transition-colors cursor-pointer ${
                isDark ? 'border-white/10 hover:bg-white/10 text-zinc-300' : 'border-slate-200 hover:bg-slate-100 text-slate-700'
              }`}
            >
              Cerrar
            </button>
            <button
              type="button"
              onClick={handleSaveConfig}
              className="px-5 py-2.5 rounded-xl bg-[#0066FF] hover:bg-blue-600 text-white font-bold text-xs transition-colors cursor-pointer shadow-lg shadow-[#0066FF]/25 flex items-center gap-1.5"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>Guardar y Aplicar</span>
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};

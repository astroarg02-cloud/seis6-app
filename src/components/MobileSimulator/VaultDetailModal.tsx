import React, { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  ArrowLeft, Share2, Download, Heart, MessageSquare, 
  CheckCircle2, Send, Shield, Copy, Check, HardDrive, X, Trash2, Info, FolderPlus, FolderCheck,
  UploadCloud, AlertCircle
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { VaultItem, UserProfile, VaultList } from '../../types';
import { VerifiedBadge } from '../VerifiedBadge';
import { useTheme } from '../../context/ThemeContext';
import { downloadVaultItemResource } from '../../services/zipExporter';
import { hasVaultItemFile } from '../../utils/vaultHelpers';
import { getListIcon } from '../../utils/listIcons';
import { resolveApiUrl, safeFetchApi, firebaseService, isStandaloneApp, getRemoteServerBaseUrl } from '../../services/firebaseService';

interface VaultDetailModalProps {
  item: VaultItem;
  currentUser: UserProfile;
  onClose: () => void;
  onToggleLike: (itemId: string) => void;
  onAddComment: (itemId: string, text: string) => void;
  onDeleteItem?: (itemId: string) => void;
  onUpdateItem?: (updatedItem: VaultItem) => void;
  lists?: VaultList[];
  onToggleItemInList?: (listId: string, itemId: string) => void;
}

export const VaultDetailModal: React.FC<VaultDetailModalProps> = ({
  item,
  currentUser,
  onClose,
  onToggleLike,
  onAddComment,
  onDeleteItem,
  onUpdateItem,
  lists = [],
  onToggleItemInList,
}) => {
  const isLiked = Array.isArray(item.likedBy) && item.likedBy.includes(currentUser.uid);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [isDownloaded, setIsDownloaded] = useState(false);
  const [downloadSuccessPath, setDownloadSuccessPath] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [isReuploading, setIsReuploading] = useState(false);
  const [reuploadProgress, setReuploadProgress] = useState<number | null>(null);
  const [reuploadSuccess, setReuploadSuccess] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [commentText, setCommentText] = useState('');
  const [showShareModal, setShowShareModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showListPicker, setShowListPicker] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [likeAnimating, setLikeAnimating] = useState(false);
  const { isDark } = useTheme();

  // Find which lists contain this item
  const itemLists = lists.filter((l) => Array.isArray(l.itemIds) && l.itemIds.includes(item.id));

  // Verifica si la publicación tiene un archivo real adjunto/subido
  const hasFile = hasVaultItemFile(item);

  // Handle Real Functional Download and return to Vault Page
  const handleDownload = async () => {
    if (downloadProgress !== null || isDownloaded) return;
    setDownloadProgress(25);
    setDownloadError(null);
    setDownloadSuccessPath(null);

    try {
      setDownloadProgress(65);
      const res = await downloadVaultItemResource(item);
      setDownloadProgress(100);

      const isSuccess = typeof res === 'boolean' ? res : res?.success;
      const savedPath = typeof res === 'object' ? res?.savedPath : undefined;

      if (isSuccess) {
        setIsDownloaded(true);
        if (savedPath) {
          setDownloadSuccessPath(savedPath);
        }
        confetti({
          particleCount: 50,
          spread: 70,
          origin: { y: 0.7 },
          colors: ['#0066FF', '#3385FF', '#10B981', '#FFFFFF'],
        });

        // Dar tiempo al usuario para ver la ruta donde se guardó el archivo
        setTimeout(() => {
          onClose();
        }, 2600);
      } else {
        const errorMsg =
          typeof res === 'object' && res?.error
            ? res.error
            : item.fileName
            ? `El archivo original ("${item.fileName}") no se pudo descargar en el dispositivo.${currentUser.role === 'admin' ? ' Puedes adjuntarlo con el botón "Re-subir archivo real" a continuación.' : ' Contacta al administrador.'}`
            : 'No hay archivo descargable disponible para esta publicación.';
        setDownloadError(errorMsg);
      }
    } catch (err: any) {
      console.error('Error during item download:', err);
      setDownloadError(err?.message || 'Ocurrió un error al descargar el archivo.');
    } finally {
      setTimeout(() => {
        setDownloadProgress(null);
      }, 1000);
    }
  };

  // Re-upload / attach real file handler (Admin)
  const handleReuploadFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsReuploading(true);
    setReuploadProgress(15);
    setDownloadError(null);
    setReuploadSuccess(false);

    try {
      let uploadRes: {
        success: boolean;
        downloadUrl?: string;
        fileName?: string;
        fileSize?: string;
        fileMimeType?: string;
      } = { success: true };

      if (!isStandaloneApp() || getRemoteServerBaseUrl()) {
        const formData = new FormData();
        formData.append('itemId', item.id);
        formData.append('file', file, file.name);

        uploadRes = await new Promise<{
          success: boolean;
          downloadUrl?: string;
          fileName?: string;
          fileSize?: string;
          fileMimeType?: string;
        }>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.upload.onprogress = (event) => {
            if (event.lengthComputable && event.total > 0) {
              const percent = Math.round((event.loaded / event.total) * 75) + 20;
              setReuploadProgress(percent);
            }
          };
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              try {
                resolve(JSON.parse(xhr.responseText));
              } catch {
                resolve({
                  success: true,
                  downloadUrl: `/api/vault/download/${encodeURIComponent(item.id)}`,
                });
              }
            } else {
              reject(new Error(`Error del servidor (${xhr.status})`));
            }
          };
          xhr.onerror = () => reject(new Error('Fallo de red en la subida'));
          xhr.open('POST', resolveApiUrl(`/api/vault/upload-file?itemId=${encodeURIComponent(item.id)}`), true);
          xhr.send(formData);
        });
      }

      setReuploadProgress(100);

      const updatedItem: VaultItem = {
        ...item,
        fileName: uploadRes.fileName || file.name,
        fileSize: uploadRes.fileSize || `${(file.size / (1024 * 1024)).toFixed(2)} MB`,
        fileType: file.name.split('.').pop()?.toUpperCase() || item.fileType || 'Archivo',
        fileMimeType: uploadRes.fileMimeType || file.type,
        downloadUrl: uploadRes.downloadUrl || `/api/vault/download/${encodeURIComponent(item.id)}`,
        rawFileBlob: file,
      };

      if (onUpdateItem) {
        onUpdateItem(updatedItem);
      }

      // Persist to server (if available) and Firestore directly
      try {
        await safeFetchApi('/api/vault/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updatedItem),
        }, 2000);
      } catch (e) {}

      try {
        await firebaseService.saveVaultItemToFirestore(updatedItem);
      } catch (e) {}

      setIsReuploading(false);
      setReuploadProgress(null);
      setReuploadSuccess(true);
      setTimeout(() => setReuploadSuccess(false), 3000);
    } catch (err: any) {
      console.error('Error re-uploading file:', err);
      setIsReuploading(false);
      setReuploadProgress(null);
      setDownloadError(`Error al subir archivo: ${err.message}`);
    }
  };

  // Handle Like Animation
  const handleLike = () => {
    setLikeAnimating(true);
    onToggleLike(item.id);
    setTimeout(() => setLikeAnimating(false), 300);
  };

  // Handle Comment Submission
  const handleCommentSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!commentText.trim()) return;
    onAddComment(item.id, commentText.trim());
    setCommentText('');
  };

  // Handle Share Copy
  const shareUrl = `https://vault.privateserver.io/invite/r_${item.id}?auth=secure_token`;

  const copyShareLink = () => {
    navigator.clipboard.writeText(shareUrl);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  // Handle Delete Item (Admin)
  const handleDelete = async () => {
    if (!onDeleteItem || isDeleting) return;
    setIsDeleting(true);
    try {
      await onDeleteItem(item.id);
      onClose();
    } catch (err) {
      console.error('Error deleting item:', err);
    } finally {
      setIsDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-end sm:items-center justify-center p-0 sm:p-4"
    >
      <motion.div
        id="vault-detail-modal-container"
        initial={{ opacity: 0, scale: 0.96, y: 24 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 24 }}
        transition={{ type: 'spring', stiffness: 380, damping: 28 }}
        className={`w-full max-w-lg sm:max-w-xl md:max-w-2xl max-h-[94dvh] sm:max-h-[90dvh] rounded-t-3xl sm:rounded-3xl flex flex-col overflow-hidden shadow-[0_20px_50px_rgba(0,0,0,0.5)] border-t sm:border transition-colors duration-300 relative ${
          isDark ? 'bg-black border-[#1E1E24] text-white' : 'bg-[#F8FAFC] border-[#CBD5E1] text-[#0F172A]'
        }`}
      >
        {/* Top Floating Notification when downloaded */}
        <AnimatePresence>
          {isDownloaded && (
            <motion.div 
              initial={{ y: -50, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -50, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 400, damping: 25 }}
              className="absolute top-0 left-0 right-0 z-50 bg-emerald-600 text-white px-4 py-2.5 text-xs font-semibold flex items-center justify-between shadow-xl"
            >
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-white" />
                <span>¡Archivo descargado! Volviendo a la bóveda...</span>
              </div>
              <span className="text-[10px] bg-emerald-700/80 px-2 py-0.5 rounded font-mono">
                Redirigiendo...
              </span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Top App Bar */}
        <div
          className={`shrink-0 flex items-center justify-between px-3.5 py-2.5 border-b backdrop-blur-md transition-colors ${
            isDark
              ? 'border-[#1E1E24] bg-black/90'
              : 'border-[#E2E8F0] bg-white/95 shadow-sm'
          }`}
        >
          <motion.button
            id="vault-detail-back-btn"
            onClick={onClose}
            whileHover={{ scale: 1.05, x: -2 }}
            whileTap={{ scale: 0.95 }}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl transition-all border cursor-pointer ${
              isDark
                ? 'bg-[#121216] text-white hover:bg-[#1E1E24] border-[#1E1E24]'
                : 'bg-slate-100 text-[#0F172A] hover:bg-slate-200 border-[#E2E8F0]'
            }`}
            title="Salir de la publicación"
          >
            <ArrowLeft className="w-4 h-4 text-[#0066FF]" />
            <span className="text-xs font-bold">Volver</span>
          </motion.button>

          <div className="text-xs font-bold tracking-widest text-[#0066FF] uppercase flex items-center gap-1.5">
            <Shield className="w-3.5 h-3.5" />
            <span>Ficha de Contenido</span>
          </div>

          <div className="flex items-center gap-1">
            {currentUser.role === 'admin' && onDeleteItem && (
              <motion.button
                id="vault-detail-delete-btn"
                onClick={() => setShowDeleteConfirm(true)}
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                className={`p-2 rounded-xl transition-colors cursor-pointer ${
                  isDark
                    ? 'text-red-400 hover:bg-red-500/20 hover:text-red-300'
                    : 'text-red-500 hover:bg-red-50 hover:text-red-600'
                }`}
                title="Eliminar Publicación (Admin)"
              >
                <Trash2 className="w-4 h-4" />
              </motion.button>
            )}

            <motion.button
              id="vault-share-btn"
              onClick={() => setShowShareModal(true)}
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
              className={`p-2 rounded-xl transition-colors cursor-pointer ${
                isDark
                  ? 'text-white hover:bg-[#121216]'
                  : 'text-[#0F172A] hover:bg-slate-100'
              }`}
              title="Compartir Invitación"
            >
              <Share2 className={`w-4 h-4 ${isDark ? 'text-[#8E8E93] hover:text-white' : 'text-[#64748B] hover:text-[#0F172A]'}`} />
            </motion.button>

            {/* Direct Close Button with X */}
            <motion.button
              id="vault-close-x-btn"
              onClick={onClose}
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
              className={`p-2 rounded-xl transition-colors cursor-pointer ${
                isDark
                  ? 'text-white hover:bg-red-500/20 hover:text-red-400'
                  : 'text-[#0F172A] hover:bg-red-50 hover:text-red-500'
              }`}
              title="Cerrar y salir"
            >
              <X className="w-4 h-4" />
            </motion.button>
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-4 sm:p-5 space-y-4 min-h-0">
          {/* Cover Preview */}
          <div
            className={`relative rounded-2xl overflow-hidden border group transition-colors ${
              isDark ? 'border-[#1E1E24] bg-[#0A0A0C]' : 'border-[#E2E8F0] bg-white shadow-sm'
            }`}
          >
            <img
              src={item.coverImage}
              alt={item.title}
              className="w-full h-44 sm:h-48 object-cover transition-transform duration-500 group-hover:scale-105"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
            
            <div className="absolute top-3 right-3">
              <span className="px-2.5 py-1 rounded-md bg-black/80 backdrop-blur-md text-[10px] font-bold text-white border border-white/20">
                {item.version || 'v1.0'}
              </span>
            </div>

            <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between">
              {hasFile && (item.fileType || item.fileSize) ? (
                <div className="flex items-center gap-2">
                  {item.fileType && (
                    <span className="px-2.5 py-1 rounded-md bg-[#0066FF] text-[10px] font-extrabold text-white uppercase tracking-wider">
                      {item.fileType}
                    </span>
                  )}
                  {item.fileSize && (
                    <span className="text-xs text-white/90 bg-black/60 px-2 py-0.5 rounded backdrop-blur-sm">
                      {item.fileSize}
                    </span>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-black/60 backdrop-blur-sm text-[10px] font-medium text-white/90 border border-white/10">
                  <Info className="w-3 h-3 text-[#0066FF]" />
                  <span>Publicación de Contenido</span>
                </div>
              )}
              <div className="flex items-center gap-1 text-[11px] text-white/90 bg-black/60 px-2 py-0.5 rounded">
                <HardDrive className="w-3 h-3 text-[#0066FF]" />
                <span>Alojado por Admin</span>
              </div>
            </div>
          </div>

          {/* Title and Action Meta */}
          <div className="space-y-2.5">
            <h1
              className={`text-lg sm:text-xl font-bold leading-tight tracking-tight ${
                isDark ? 'text-white' : 'text-[#0F172A]'
              }`}
            >
              {item.title}
            </h1>

            <div className="flex items-center justify-between pt-0.5">
              <div className={`flex items-center gap-1.5 text-xs ${isDark ? 'text-[#8E8E93]' : 'text-[#64748B]'}`}>
                <span className="w-2 h-2 rounded-full bg-[#0066FF]" />
                <span className={`font-medium ${isDark ? 'text-white' : 'text-[#0F172A]'}`}>{item.author?.name || 'Administrador'}</span>
                <VerifiedBadge className="w-3.5 h-3.5" />
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded font-semibold border ${
                    isDark
                      ? 'bg-[#121216] border-[#1E1E24] text-[#0066FF]'
                      : 'bg-blue-50 border-blue-200 text-[#0066FF]'
                  }`}
                >
                  {item.author?.badge || 'Admin Master'}
                </span>
              </div>

              {/* Animated Like Button with spring bounce */}
              <motion.button
                id={`vault-like-btn-${item.id}`}
                onClick={handleLike}
                whileHover={{ scale: 1.06 }}
                whileTap={{ scale: 0.92 }}
                transition={{ type: 'spring', stiffness: 450, damping: 18 }}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-full border text-xs font-semibold transition-colors cursor-pointer ${
                  isLiked
                    ? 'bg-[#0066FF]/15 border-[#0066FF] text-[#0066FF] shadow-sm'
                    : isDark
                    ? 'bg-[#0A0A0C] border-[#1E1E24] text-[#8E8E93] hover:text-white'
                    : 'bg-white border-[#E2E8F0] text-[#64748B] hover:text-[#0F172A] shadow-sm'
                }`}
              >
                <motion.div
                  animate={likeAnimating ? { scale: [1, 1.4, 1], rotate: [0, -12, 12, 0] } : {}}
                  transition={{ duration: 0.3 }}
                >
                  <Heart
                    className={`w-3.5 h-3.5 ${isLiked ? 'fill-[#FF2E63] text-[#FF2E63]' : ''}`}
                  />
                </motion.div>
                <span>{item.likesCount}</span>
              </motion.button>
            </div>

            {/* Listas a las que pertenece esta publicación */}
            <div className="flex items-center gap-2 flex-wrap pt-1">
              {itemLists.length > 0 ? (
                itemLists.map((list) => {
                  const ListIconComponent = getListIcon(list.icon);
                  return (
                    <div
                      key={list.id}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold border ${
                        isDark ? 'bg-[#121216] border-[#1E1E24] text-white' : 'bg-white border-[#CBD5E1] text-[#0F172A] shadow-xs'
                      }`}
                    >
                      <ListIconComponent className="w-3.5 h-3.5" style={{ color: list.color || '#0066FF' }} />
                      <span>{list.name}</span>
                    </div>
                  );
                })
              ) : null}

              {currentUser.role === 'admin' && onToggleItemInList && lists.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowListPicker(!showListPicker)}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-colors cursor-pointer ${
                    showListPicker
                      ? 'bg-[#0066FF] border-[#0066FF] text-white'
                      : isDark
                      ? 'border-dashed border-[#2A2A34] text-[#8E8E93] hover:text-white hover:border-[#0066FF]'
                      : 'border-dashed border-[#CBD5E1] text-[#64748B] hover:text-[#0F172A] hover:border-[#0066FF]'
                  }`}
                >
                  <FolderPlus className="w-3.5 h-3.5" />
                  <span>Gestionar Listas</span>
                </button>
              )}
            </div>

            {/* Admin Quick List Assignment Popover */}
            <AnimatePresence>
              {showListPicker && currentUser.role === 'admin' && onToggleItemInList && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className={`p-3 rounded-2xl border space-y-2 overflow-hidden transition-colors ${
                    isDark ? 'bg-[#121216] border-[#0066FF]/40' : 'bg-blue-50/60 border-[#0066FF]/40'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold uppercase text-[#0066FF] tracking-wider flex items-center gap-1">
                      <FolderCheck className="w-3.5 h-3.5" />
                      <span>Incluir en listas:</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowListPicker(false)}
                      className="text-xs text-slate-400 hover:text-white cursor-pointer"
                    >
                      Listo
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {lists.map((l) => {
                      const isInside = Array.isArray(l.itemIds) && l.itemIds.includes(item.id);
                      const IconComp = getListIcon(l.icon);
                      return (
                        <button
                          key={l.id}
                          type="button"
                          onClick={() => onToggleItemInList(l.id, item.id)}
                          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${
                            isInside
                              ? 'bg-[#0066FF] border-[#0066FF] text-white shadow-sm'
                              : isDark
                              ? 'bg-[#0A0A0C] border-[#1E1E24] text-[#8E8E93] hover:text-white'
                              : 'bg-white border-[#E2E8F0] text-[#64748B] hover:text-[#0F172A]'
                          }`}
                        >
                          <IconComp className="w-3 h-3" />
                          <span>{l.name}</span>
                          {isInside && <Check className="w-3 h-3 ml-0.5" />}
                        </button>
                      );
                    })}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Description */}
          <div
            className={`rounded-xl p-3.5 text-xs sm:text-sm leading-relaxed border transition-colors ${
              isDark
                ? 'bg-[#0A0A0C] border-[#1E1E24] text-[#8E8E93]'
                : 'bg-white border-[#E2E8F0] text-[#475569] shadow-sm'
            }`}
          >
            <p>{item.description}</p>
          </div>

          {/* Main Action: DOWNLOAD BUTTON (Rendered ONLY if a file was uploaded) */}
          {hasFile ? (
            <div className="space-y-2 pt-1">
              <motion.button
                id={`vault-download-action-btn-${item.id}`}
                onClick={handleDownload}
                disabled={downloadProgress !== null}
                whileHover={{ scale: 1.02, y: -1 }}
                whileTap={{ scale: 0.98 }}
                transition={{ type: 'spring', stiffness: 400, damping: 20 }}
                className={`w-full py-3.5 px-5 rounded-xl font-bold text-xs sm:text-sm tracking-wide uppercase transition-all flex items-center justify-center gap-2 shadow-lg cursor-pointer ${
                  isDownloaded
                    ? 'bg-[#10B981] text-white shadow-[#10B981]/25 hover:bg-[#059669]'
                    : downloadProgress !== null
                    ? 'bg-[#0066FF]/70 text-white cursor-wait'
                    : 'bg-[#0066FF] hover:bg-[#0052FF] text-white shadow-[#0066FF]/30 active:scale-[0.99]'
                }`}
              >
                {isDownloaded ? (
                  <>
                    <CheckCircle2 className="w-4 h-4" />
                    <span>¡Descargado! Regresando a la Bóveda...</span>
                  </>
                ) : downloadProgress !== null ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Generando descarga... {downloadProgress}%</span>
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4" />
                    <span>Descargar Archivo {item.fileSize ? `(${item.fileSize})` : ''}</span>
                  </>
                )}
              </motion.button>

              {downloadProgress !== null && (
                <div
                  className={`w-full rounded-full h-1.5 overflow-hidden ${
                    isDark ? 'bg-[#121216]' : 'bg-slate-200'
                  }`}
                >
                  <motion.div
                    className="bg-[#0066FF] h-full"
                    initial={{ width: '0%' }}
                    animate={{ width: `${downloadProgress}%` }}
                    transition={{ ease: 'easeOut', duration: 0.25 }}
                  />
                </div>
              )}

              <div
                className={`flex items-center justify-between text-[10px] px-1 ${
                  isDark ? 'text-[#5A5A62]' : 'text-[#94A3B8]'
                }`}
              >
                <span>{item.fileName ? `Archivo original: ${item.fileName}` : 'Descarga directa en formato original'}</span>
                <span>Formato Genuino • Verificado</span>
              </div>

              {/* Download Success Location Banner */}
              {downloadSuccessPath && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="p-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 text-xs flex items-start gap-2.5"
                >
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-400" />
                  <div className="flex-1">
                    <p className="font-bold text-white text-xs">Descarga completada</p>
                    <p className="text-emerald-300 text-[11px] mt-0.5 leading-relaxed">
                      Guardado en: <span className="font-semibold text-white">{downloadSuccessPath}</span>
                    </p>
                  </div>
                </motion.div>
              )}
            </div>
          ) : null}

          {/* Download Error Banner */}
          {downloadError && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-3 rounded-xl border border-red-500/30 bg-red-500/10 text-red-400 text-xs flex items-start gap-2"
            >
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-400" />
              <div className="flex-1">
                <p className="font-semibold">{downloadError}</p>
              </div>
            </motion.div>
          )}

          {/* Re-upload Success Banner */}
          {reuploadSuccess && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 text-xs flex items-center gap-2"
            >
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
              <span>¡Archivo real subido y vinculado a la publicación exitosamente!</span>
            </motion.div>
          )}

          {/* Admin Fast Re-Upload / Attach Real File (Sin límite de tamaño) */}
          {currentUser.role === 'admin' && (
            <div className={`p-3 rounded-xl border ${isDark ? 'bg-[#121216] border-[#1E1E24]' : 'bg-slate-50 border-slate-200'}`}>
              <input
                type="file"
                ref={fileInputRef}
                className="hidden"
                onChange={handleReuploadFile}
              />
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                <div className="text-xs">
                  <span className={`font-bold block ${isDark ? 'text-white' : 'text-slate-800'}`}>
                    {hasFile ? 'Actualizar Archivo Real' : 'Adjuntar Archivo Real a la Publicación'}
                  </span>
                  <span className={`text-[11px] ${isDark ? 'text-[#8E8E93]' : 'text-slate-500'}`}>
                    Almacenamiento en servidor • Sin límite de megas
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isReuploading}
                  className="w-full sm:w-auto px-3 py-2 sm:py-1.5 rounded-lg bg-[#0066FF] hover:bg-[#0052FF] disabled:opacity-50 text-white text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer shrink-0"
                >
                  <UploadCloud className="w-3.5 h-3.5" />
                  <span>{isReuploading ? `Subiendo (${reuploadProgress || 0}%)` : hasFile ? 'Re-subir archivo' : 'Subir archivo'}</span>
                </button>
              </div>

              {isReuploading && (
                <div className="mt-2 w-full bg-black/20 rounded-full h-1.5 overflow-hidden">
                  <div
                    className="bg-[#0066FF] h-full transition-all duration-200"
                    style={{ width: `${reuploadProgress || 0}%` }}
                  />
                </div>
              )}
            </div>
          )}

          {/* Private Forum / Comments Section */}
          <div
            className={`pt-4 border-t space-y-3 ${
              isDark ? 'border-[#1E1E24]' : 'border-[#E2E8F0]'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <MessageSquare className="w-3.5 h-3.5 text-[#0066FF]" />
                <h3
                  className={`text-xs font-bold tracking-wider uppercase ${
                    isDark ? 'text-white' : 'text-[#0F172A]'
                  }`}
                >
                  Foro Privado ({item.comments?.length || 0})
                </h3>
              </div>
            </div>

            {/* Comments List with staggered animation */}
            <div className="space-y-2.5 max-h-48 overflow-y-auto custom-scrollbar pr-1">
              {!item.comments || item.comments.length === 0 ? (
                <div
                  className={`text-center py-6 rounded-xl border text-xs ${
                    isDark
                      ? 'bg-[#0A0A0C] border-[#1E1E24] text-[#5A5A62]'
                      : 'bg-white border-[#E2E8F0] text-[#94A3B8]'
                  }`}
                >
                  No hay comentarios aún en este recurso.
                </div>
              ) : (
                item.comments.map((comment, i) => (
                  <motion.div
                    key={comment.id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.2, delay: i * 0.04 }}
                    className={`p-3 rounded-xl border text-xs space-y-1.5 ${
                      isDark
                        ? 'bg-[#0A0A0C] border-[#1E1E24]'
                        : 'bg-white border-[#E2E8F0] shadow-sm'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <span className={`font-bold ${isDark ? 'text-white' : 'text-[#0F172A]'}`}>
                          {comment.userDisplayName}
                        </span>
                        {comment.userRole === 'admin' && (
                          <span className="text-[9px] px-1 py-0.2 rounded bg-amber-500/20 text-amber-400 font-bold border border-amber-500/30">
                            ADMIN
                          </span>
                        )}
                      </div>
                      <span className={`text-[10px] ${isDark ? 'text-[#5A5A62]' : 'text-[#94A3B8]'}`}>
                        {comment.createdAt}
                      </span>
                    </div>
                    <p className={`leading-relaxed ${isDark ? 'text-[#8E8E93]' : 'text-[#475569]'}`}>
                      {comment.text}
                    </p>
                  </motion.div>
                ))
              )}
            </div>

            {/* Post Comment Input */}
            <form onSubmit={handleCommentSubmit} className="flex gap-2 pt-1">
              <input
                type="text"
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                placeholder="Escribe en el hilo privado..."
                className={`flex-1 rounded-xl px-3.5 py-2 text-xs transition-all focus:outline-none focus:ring-2 focus:ring-[#0066FF]/30 focus:border-[#0066FF] border ${
                  isDark
                    ? 'bg-[#0A0A0C] border-[#1E1E24] text-white placeholder-[#5A5A62]'
                    : 'bg-white border-[#CBD5E1] text-[#0F172A] placeholder-[#94A3B8]'
                }`}
              />
              <motion.button
                type="submit"
                disabled={!commentText.trim()}
                whileHover={{ scale: 1.06 }}
                whileTap={{ scale: 0.94 }}
                transition={{ type: 'spring', stiffness: 400, damping: 20 }}
                className="px-3.5 py-2 rounded-xl bg-[#0066FF] hover:bg-[#0052FF] disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-bold transition-all flex items-center justify-center shadow-md shadow-[#0066FF]/20 cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" />
              </motion.button>
            </form>
          </div>
        </div>

        {/* Share Modal Popup */}
        <AnimatePresence>
          {showShareModal && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
            >
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                className={`w-full max-w-xs rounded-2xl p-4 border space-y-3 ${
                  isDark ? 'bg-[#0A0A0C] border-[#1E1E24]' : 'bg-white border-[#E2E8F0] shadow-xl'
                }`}
              >
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-[#0066FF] uppercase tracking-wider">
                    Enlace de Invitación
                  </h4>
                  <button
                    onClick={() => setShowShareModal(false)}
                    className="text-zinc-400 hover:text-white text-xs font-bold p-1 cursor-pointer"
                  >
                    ✕
                  </button>
                </div>

                <div
                  className={`p-2 rounded-xl border text-[11px] font-mono break-all ${
                    isDark ? 'bg-black border-[#1E1E24] text-[#8E8E93]' : 'bg-slate-50 border-[#E2E8F0] text-[#64748B]'
                  }`}
                >
                  {shareUrl}
                </div>

                <motion.button
                  onClick={copyShareLink}
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.97 }}
                  className="w-full py-2 rounded-xl bg-[#0066FF] hover:bg-[#0052FF] text-white text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                >
                  {copiedLink ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedLink ? 'Copiado' : 'Copiar Enlace'}</span>
                </motion.button>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Delete Confirmation Modal */}
        <AnimatePresence>
          {showDeleteConfirm && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4"
            >
              <motion.div
                initial={{ scale: 0.9, opacity: 0, y: 10 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.9, opacity: 0, y: 10 }}
                transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                className={`w-full max-w-xs rounded-2xl p-4 border space-y-3 ${
                  isDark ? 'bg-[#0A0A0C] border-[#1E1E24]' : 'bg-white border-[#E2E8F0] shadow-xl'
                }`}
              >
                <h4 className="text-xs font-bold text-red-500 uppercase tracking-wider">
                  ¿Eliminar publicación?
                </h4>
                <p className={`text-xs ${isDark ? 'text-[#8E8E93]' : 'text-[#64748B]'}`}>
                  Se borrará permanentemente de la bóveda.
                </p>
                <div className="flex gap-2 pt-1">
                  <motion.button
                    onClick={handleDelete}
                    disabled={isDeleting}
                    whileHover={{ scale: 1.03 }}
                    whileTap={{ scale: 0.97 }}
                    className="flex-1 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold cursor-pointer"
                  >
                    {isDeleting ? 'Borrando...' : 'Eliminar'}
                  </motion.button>
                  <motion.button
                    onClick={() => setShowDeleteConfirm(false)}
                    whileHover={{ scale: 1.03 }}
                    whileTap={{ scale: 0.97 }}
                    className="px-3 py-2 rounded-xl border border-zinc-700 text-zinc-300 text-xs font-semibold cursor-pointer"
                  >
                    Cancelar
                  </motion.button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );
};

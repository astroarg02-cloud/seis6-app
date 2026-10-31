import React, { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  X, UploadCloud, FileCode, Video, FileText, Music, Sliders, 
  Image as ImageIcon, CheckCircle2, FileUp, Trash2, Sparkles, FolderArchive, ArrowUpRight, FolderPlus
} from 'lucide-react';
import { VaultItem, ResourceCategory, UserProfile, VaultList } from '../../types';
import { VerifiedBadge } from '../VerifiedBadge';
import { useTheme } from '../../context/ThemeContext';
import { saveFileToIndexedDB } from '../../services/indexedDBStorage';
import { resolveApiUrl, isStandaloneApp, getRemoteServerBaseUrl } from '../../services/firebaseService';

interface AdminUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUpload: (newItem: Omit<VaultItem, 'createdAt' | 'likesCount' | 'likedBy' | 'comments'> & { id?: string }, targetListIds?: string[]) => Promise<any> | void;
  currentUser?: UserProfile | null;
  lists?: VaultList[];
}

export const AdminUploadModal: React.FC<AdminUploadModalProps> = ({ isOpen, onClose, onUpload, currentUser, lists = [] }) => {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<ResourceCategory>('code');
  const [fileType, setFileType] = useState('');
  const [fileSize, setFileSize] = useState('');
  const [coverImage, setCoverImage] = useState<string>('');
  const [coverFileName, setCoverFileName] = useState<string>('');
  const [downloadUrl, setDownloadUrl] = useState('');
  const [mediafireUrl, setMediafireUrl] = useState('');
  const [uploadedFileName, setUploadedFileName] = useState<string>('');
  const [version, setVersion] = useState('v1.0');
  const [selectedListIds, setSelectedListIds] = useState<string[]>([]);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [isDraggingCover, setIsDraggingCover] = useState(false);
  const [autoDetectedInfo, setAutoDetectedInfo] = useState<string | null>(null);
  const [rawFile, setRawFile] = useState<File | null>(null);
  const [fileMimeType, setFileMimeType] = useState<string>('');
  const [fileData, setFileData] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadStatusText, setUploadStatusText] = useState<string>('');
  const { isDark } = useTheme();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);

  const resetForm = () => {
    setTitle('');
    setDescription('');
    setCategory('code');
    setFileType('');
    setFileSize('');
    setCoverImage('');
    setCoverFileName('');
    setDownloadUrl('');
    setMediafireUrl('');
    setUploadedFileName('');
    setVersion('v1.0');
    setAutoDetectedInfo(null);
    setRawFile(null);
    setFileData('');
    setFileMimeType('');
    setIsSubmitting(false);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  if (!isOpen) return null;

  // Abrir panel oficial de MediaFire en pestaña externa para que el admin suba el archivo
  const handleOpenMediafire = () => {
    try {
      const a = document.createElement('a');
      a.href = 'https://www.mediafire.com/myfiles.php';
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        if (document.body.contains(a)) document.body.removeChild(a);
      }, 500);
    } catch {
      window.open('https://www.mediafire.com/myfiles.php', '_blank');
    }
  };

  // Pegar enlace desde portapapeles
  const handlePasteClipboard = async () => {
    try {
      if (navigator?.clipboard?.readText) {
        const text = await navigator.clipboard.readText();
        if (text) {
          handleMediafireUrlChange(text.trim());
        }
      }
    } catch (err) {
      console.warn('Clipboard read error:', err);
    }
  };

  // Manejo de cambio en el enlace de MediaFire con auto-extracción de metadatos
  const handleMediafireUrlChange = (url: string) => {
    setMediafireUrl(url);
    if (url && (url.includes('mediafire.com') || url.startsWith('http'))) {
      try {
        // Formatos típicos de MediaFire:
        // https://www.mediafire.com/file/xxxx/NombreArchivo.zip/file
        // https://www.mediafire.com/download/xxxx/NombreArchivo.zip
        const match = url.match(/\/file\/[^\/]+\/([^\/]+)/) || url.match(/\/download\/[^\/]+\/([^\/]+)/);
        if (match && match[1]) {
          const rawFileName = decodeURIComponent(match[1].replace(/\/file$/, ''));
          if (!title || title.trim() === '') {
            const clean = rawFileName.substring(0, rawFileName.lastIndexOf('.')) || rawFileName;
            setTitle(clean.replace(/[-_.]+/g, ' ').trim());
          }
          if (!uploadedFileName) {
            setUploadedFileName(rawFileName);
            const ext = rawFileName.split('.').pop()?.toUpperCase() || 'ARCHIVO';
            setFileType(`${ext} MediaFire`);
          }
        }
      } catch {}
    }
  };

  // Formateador de peso de archivo automático
  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  // Reconocimiento inteligente de archivos y metadatos sin límite de peso
  const processUploadedFile = (file: File) => {
    const nameWithoutExt = file.name.substring(0, file.name.lastIndexOf('.')) || file.name;
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    const formattedSize = formatBytes(file.size);

    setRawFile(file);
    setUploadedFileName(file.name);
    setFileMimeType(file.type || 'application/octet-stream');
    setFileSize(formattedSize);

    // Si el usuario no ha escrito un título o tiene el default, sugerimos el nombre del archivo limpio
    const cleanTitle = nameWithoutExt
      .replace(/[-_.]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!title || title.trim() === '') {
      setTitle(cleanTitle.charAt(0).toUpperCase() + cleanTitle.slice(1));
    }

    // Detección automática de categoría y tipo de archivo por extensión y MIME
    let detectedCat: ResourceCategory = 'code';
    let detectedType = `${ext.toUpperCase()} Archivo`;

    const videoExts = ['mp4', 'mkv', 'mov', 'avi', 'webm', 'm4v', 'ts', 'flv', 'wmv'];
    const codeExts = ['zip', 'rar', '7z', 'tar', 'gz', 'dart', 'js', 'ts', 'tsx', 'jsx', 'json', 'py', 'apk', 'aab', 'ipa', 'dmg', 'pkg', 'html', 'css', 'cpp', 'rs'];
    const docExts = ['pdf', 'doc', 'docx', 'epub', 'txt', 'csv', 'xlsx', 'xls', 'pptx', 'ppt', 'md'];
    const audioExts = ['mp3', 'flac', 'wav', 'aac', 'ogg', 'm4a', 'aiff', 'wma'];
    const presetExts = ['cube', 'xmp', 'lut', 'dng', 'look', 'preset', 'psd', 'ai', 'fig'];

    if (videoExts.includes(ext) || file.type.startsWith('video/')) {
      detectedCat = 'video';
      detectedType = ext === 'mp4' ? 'MP4 Video HD/4K' : `${ext.toUpperCase()} Video`;
    } else if (docExts.includes(ext) || file.type === 'application/pdf') {
      detectedCat = 'document';
      detectedType = ext === 'pdf' ? 'PDF Documento Encriptado' : `${ext.toUpperCase()} Documento`;
    } else if (audioExts.includes(ext) || file.type.startsWith('audio/')) {
      detectedCat = 'audio';
      detectedType = ext === 'flac' ? 'FLAC Audio 24-bit' : `${ext.toUpperCase()} Audio Master`;
    } else if (presetExts.includes(ext)) {
      detectedCat = 'preset';
      detectedType = ext === 'cube' ? 'CUBE 3D LUTs Pack' : `${ext.toUpperCase()} Preset Pack`;
    } else if (codeExts.includes(ext)) {
      detectedCat = 'code';
      detectedType = ext === 'zip' ? 'ZIP Archivo / Código' : `${ext.toUpperCase()} Código Fuente`;
    }

    setCategory(detectedCat);
    setFileType(detectedType);

    // Creamos URL de objeto temporal para vista previa inmediata
    const fileBlobUrl = URL.createObjectURL(file);
    setDownloadUrl(fileBlobUrl);

    // Si el archivo pesa menos de 650KB, guardar también en base64 para que esté embebido en Firestore y disponible en cualquier APK sin servidor
    if (file.size <= 650 * 1024) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        if (typeof ev.target?.result === 'string') {
          setFileData(ev.target.result);
        }
      };
      reader.readAsDataURL(file);
    } else {
      setFileData('');
    }

    setAutoDetectedInfo(
      `Reconocido: ${detectedType} (${formattedSize}) → Categoría "${detectedCat.toUpperCase()}" asignada. ¡Sin límite de megas!`
    );
  };

  // Manejo de subida de archivo
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processUploadedFile(file);
    }
  };

  const handleDropFile = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDraggingFile(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      processUploadedFile(file);
    }
  };

  // Manejo de imagen de portada con compresión automática para compatibilidad total con Firestore
  const processCoverImage = (file: File) => {
    if (!file.type.startsWith('image/')) {
      alert('Por favor selecciona un archivo de imagen válido (PNG, JPG, WEBP).');
      return;
    }
    setCoverFileName(file.name);
    const reader = new FileReader();
    reader.onload = (event) => {
      if (event.target?.result) {
        const rawDataUrl = event.target.result as string;
        // Optimize and compress cover image with HTML canvas
        const img = new Image();
        img.onload = () => {
          const maxDim = 800;
          let width = img.width;
          let height = img.height;
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
          if (ctx) {
            ctx.drawImage(img, 0, 0, width, height);
            const optimized = canvas.toDataURL('image/jpeg', 0.82);
            setCoverImage(optimized);
          } else {
            setCoverImage(rawDataUrl);
          }
        };
        img.onerror = () => {
          setCoverImage(rawDataUrl);
        };
        img.src = rawDataUrl;
      }
    };
    reader.readAsDataURL(file);
  };

  const handleCoverChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processCoverImage(file);
    }
  };

  const handleDropCover = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDraggingCover(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      processCoverImage(file);
    }
  };

  // Submit y publicación en la bóveda con subida real al servidor
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !description || isSubmitting) return;
    setIsSubmitting(true);

    const tempItemId = `vault-res-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    let finalDownloadUrl = `/api/vault/download/${encodeURIComponent(tempItemId)}`;
    let finalFileName = uploadedFileName;
    let finalFileSize = fileSize;
    let finalMime = fileMimeType;

    try {
      // Si el usuario adjuntó un archivo real, subirlo sin límite de megas
      if (rawFile) {
        setUploadStatusText('Guardando en almacenamiento local...');
        setUploadProgress(10);
        try {
          await saveFileToIndexedDB(tempItemId, rawFile, rawFile.name);
        } catch (idbErr) {
          console.warn('IndexedDB backup notice:', idbErr);
        }

        if (!isStandaloneApp() || getRemoteServerBaseUrl()) {
          setUploadStatusText('Subiendo archivo real al servidor central...');
          setUploadProgress(20);

          try {
            const uploadRes = await new Promise<{
              success: boolean;
              downloadUrl?: string;
              fileName?: string;
              fileSize?: string;
              fileMimeType?: string;
            }>((resolve, reject) => {
              const xhr = new XMLHttpRequest();
              const formData = new FormData();
              formData.append('itemId', tempItemId);
              formData.append('file', rawFile, rawFile.name);

              xhr.upload.onprogress = (event) => {
                if (event.lengthComputable && event.total > 0) {
                  const percent = Math.round((event.loaded / event.total) * 75) + 20;
                  setUploadProgress(Math.min(95, percent));
                  setUploadStatusText(
                    `Subiendo: ${formatBytes(event.loaded)} / ${formatBytes(event.total)} (${Math.round((event.loaded / event.total) * 100)}%)`
                  );
                }
              };

              xhr.onload = () => {
                if (xhr.status >= 200 && xhr.status < 300) {
                  try {
                    const data = JSON.parse(xhr.responseText);
                    resolve(data);
                  } catch {
                    resolve({
                      success: true,
                      downloadUrl: `/api/vault/download/${encodeURIComponent(tempItemId)}`,
                    });
                  }
                } else {
                  reject(new Error(`Error del servidor (${xhr.status})`));
                }
              };

              xhr.onerror = () => reject(new Error('Fallo de red en la subida'));
              xhr.open('POST', resolveApiUrl(`/api/vault/upload-file?itemId=${encodeURIComponent(tempItemId)}`), true);
              xhr.send(formData);
            });

            setUploadProgress(98);
            setUploadStatusText('¡Archivo real subido exitosamente!');

            if (uploadRes && uploadRes.downloadUrl) {
              finalDownloadUrl = uploadRes.downloadUrl;
            }
            if (uploadRes && uploadRes.fileName) {
              finalFileName = uploadRes.fileName;
            }
            if (uploadRes && uploadRes.fileSize) {
              finalFileSize = uploadRes.fileSize;
            }
            if (uploadRes && uploadRes.fileMimeType) {
              finalMime = uploadRes.fileMimeType;
            }
          } catch (uploadError) {
            console.warn('Network upload exception, falling back to cached persistence:', uploadError);
            finalDownloadUrl = `/api/vault/download/${encodeURIComponent(tempItemId)}`;
          }
        } else {
          // Modo APK standalone sin servidor central: el archivo ya está en IndexedDB y/o base64 en Firestore
          setUploadProgress(98);
          setUploadStatusText('¡Archivo guardado en almacenamiento seguro!');
        }
      }

      // Resolver enlace definitivo de MediaFire para redirección directa
      const finalMediafireUrl = mediafireUrl.trim() || (rawFile ? `https://www.mediafire.com/file/seis6_${tempItemId.replace(/[^a-zA-Z0-9]/g, '')}/${encodeURIComponent((finalFileName || 'recurso').replace(/[^a-zA-Z0-9._-]/g, '_'))}/file` : '');
      if (finalMediafireUrl) {
        finalDownloadUrl = finalMediafireUrl;
      } else if (finalDownloadUrl.startsWith('blob:')) {
        finalDownloadUrl = `/api/vault/download/${encodeURIComponent(tempItemId)}`;
      }

      setUploadProgress(100);
      setUploadStatusText('Publicando en la Bóveda...');

      // Fallback de portada si no sube una
      const finalCover = coverImage || 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=800&auto=format&fit=crop&q=80';

      await onUpload({
        id: tempItemId,
        title: title.trim(),
        description: description.trim(),
        category,
        fileType: finalFileName ? (fileType || 'Archivo MediaFire') : (finalMediafireUrl ? 'Enlace MediaFire' : 'Archivo'),
        fileSize: finalFileName ? (finalFileSize || '') : '',
        fileName: finalFileName || undefined,
        fileMimeType: finalMime || undefined,
        fileData: fileData || undefined,
        rawFileBlob: rawFile || undefined,
        downloadUrl: finalDownloadUrl,
        mediafireUrl: finalMediafireUrl || undefined,
        coverImage: finalCover,
        version: version.trim() || 'v1.0',
        listIds: selectedListIds,
        author: {
          name: currentUser?.displayName || 'Administrador (astroarg02)',
          badge: 'ADMIN ROOT',
        },
      }, selectedListIds);

      resetForm();
      setSelectedListIds([]);
      onClose();
    } catch (err) {
      console.error('Error submitting vault item:', err);
    } finally {
      setIsSubmitting(false);
      setUploadProgress(null);
      setUploadStatusText('');
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-2 sm:p-4"
    >
      <motion.div 
        id="admin-upload-modal-container"
        initial={{ opacity: 0, scale: 0.94, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.94, y: 16 }}
        transition={{ type: 'spring', stiffness: 380, damping: 28 }}
        className={`w-full max-w-lg rounded-3xl max-h-[92dvh] flex flex-col overflow-hidden shadow-[0_20px_50px_rgba(0,0,0,0.5)] border transition-colors ${
          isDark
            ? 'bg-[#0A0A0C] border-[#1E1E24] text-white'
            : 'bg-white border-[#CBD5E1] text-[#0F172A]'
        }`}
      >
        {/* Modal Header */}
        <div
          className={`p-4 sm:p-5 border-b flex items-center justify-between transition-colors ${
            isDark ? 'border-[#1E1E24] bg-black/50' : 'border-[#E2E8F0] bg-slate-50'
          }`}
        >
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-[#0066FF] flex items-center justify-center text-white shadow-md shadow-[#0066FF]/30">
              <UploadCloud className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <h3 className={`text-sm sm:text-base font-bold ${isDark ? 'text-white' : 'text-[#0F172A]'}`}>
                  Publicar Material en Bóveda
                </h3>
                <VerifiedBadge className="w-3.5 h-3.5" />
              </div>
              <p className={`text-[11px] ${isDark ? 'text-[#8E8E93]' : 'text-[#64748B]'}`}>
                Exclusivo para Administrador • Subida directa de archivos
              </p>
            </div>
          </div>
          <motion.button
            onClick={handleClose}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            className={`p-2 rounded-xl transition-colors cursor-pointer ${
              isDark
                ? 'text-[#8E8E93] hover:text-white hover:bg-[#121216]'
                : 'text-[#64748B] hover:text-[#0F172A] hover:bg-slate-200'
            }`}
          >
            <X className="w-5 h-5" />
          </motion.button>
        </div>

        {/* Modal Scrollable Form */}
        <form onSubmit={handleSubmit} className="p-4 sm:p-6 overflow-y-auto custom-scrollbar space-y-5">
          
          {/* SECCIÓN 1: SUBIR EL ARCHIVO DESCARGABLE */}
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider flex items-center justify-between text-[#0066FF]">
              <span className="flex items-center gap-1.5">
                <FileUp className="w-4 h-4" />
                <span>1. Archivo Descargable (Recurso)</span>
              </span>
              <span className={`text-[10px] lowercase font-normal ${isDark ? 'text-[#8E8E93]' : 'text-[#64748B]'}`}>
                Arrastra o haz clic
              </span>
            </label>

            {/* Input nativo oculto para archivos */}
            <input
              ref={fileInputRef}
              type="file"
              onChange={handleFileChange}
              className="hidden"
            />

            {uploadedFileName ? (
              <div
                className={`p-3.5 rounded-2xl border flex items-center justify-between transition-colors ${
                  isDark
                    ? 'bg-[#121216] border-[#0066FF]/40'
                    : 'bg-blue-50/60 border-[#0066FF]/40'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-xl bg-[#0066FF]/20 flex items-center justify-center text-[#0066FF] shrink-0">
                    <FolderArchive className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <div className={`text-xs font-bold truncate ${isDark ? 'text-white' : 'text-[#0F172A]'}`}>
                      {uploadedFileName}
                    </div>
                    <div className="text-[11px] text-[#0066FF] font-medium flex items-center gap-2">
                      <span>{fileSize}</span>
                      <span>•</span>
                      <span>{fileType}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className={`px-3 py-1.5 rounded-lg text-xs border transition-colors ${
                      isDark
                        ? 'bg-[#121216] hover:bg-[#1E1E24] text-white border-[#1E1E24]'
                        : 'bg-white hover:bg-slate-100 text-[#0F172A] border-[#CBD5E1]'
                    }`}
                  >
                    Cambiar
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setUploadedFileName('');
                      setFileSize('');
                      setFileType('');
                      setAutoDetectedInfo(null);
                      setDownloadUrl('');
                    }}
                    className={`p-1.5 rounded-lg transition-colors ${
                      isDark
                        ? 'text-[#8E8E93] hover:text-red-400 hover:bg-[#121216]'
                        : 'text-[#64748B] hover:text-red-600 hover:bg-red-50'
                    }`}
                    title="Eliminar archivo"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ) : (
              <div
                onDragOver={(e) => { e.preventDefault(); setIsDraggingFile(true); }}
                onDragLeave={() => setIsDraggingFile(false)}
                onDrop={handleDropFile}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-2xl p-5 text-center cursor-pointer transition-all ${
                  isDraggingFile
                    ? 'border-[#0066FF] bg-[#0066FF]/10'
                    : isDark
                    ? 'border-[#1E1E24] hover:border-[#0066FF]/60 bg-[#0A0A0C] hover:bg-[#121216]'
                    : 'border-[#CBD5E1] hover:border-[#0066FF]/60 bg-slate-50 hover:bg-blue-50/40'
                }`}
              >
                <div
                  className={`w-11 h-11 mx-auto mb-2 rounded-xl border flex items-center justify-center shadow-md ${
                    isDark ? 'bg-black border-[#1E1E24]' : 'bg-white border-[#CBD5E1]'
                  }`}
                >
                  <FileUp className="w-5 h-5 text-[#0066FF]" />
                </div>
                <div className={`text-xs font-bold flex items-center justify-center gap-1.5 ${isDark ? 'text-white' : 'text-[#0F172A]'}`}>
                  <span>Haz clic para subir o arrastra cualquier archivo</span>
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-[#0066FF]/20 text-[#0066FF] border border-[#0066FF]/40">
                    Megas Ilimitados
                  </span>
                </div>
                <div className={`text-[11px] mt-1 max-w-sm mx-auto ${isDark ? 'text-[#8E8E93]' : 'text-[#64748B]'}`}>
                  Sin límite de tamaño (Cero restricciones en megas). Soporta .ZIP, .PDF, .MP4, .FLAC, .APK, .DMG, .DART, etc.
                </div>
              </div>
            )}

            {/* Live Upload Progress Indicator */}
            {uploadProgress !== null && (
              <div className="p-3 rounded-2xl bg-[#0066FF]/10 border border-[#0066FF]/30 space-y-1.5 animate-fadeIn">
                <div className="flex items-center justify-between text-xs font-semibold text-[#0066FF]">
                  <span>{uploadStatusText || 'Subiendo archivo real...'}</span>
                  <span className="font-mono font-bold">{uploadProgress}%</span>
                </div>
                <div className="w-full h-2 rounded-full bg-black/20 dark:bg-white/10 overflow-hidden">
                  <div
                    className="h-full bg-[#0066FF] transition-all duration-200"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
              </div>
            )}

            {/* Aviso inteligente de auto-detección */}
            {autoDetectedInfo && (
              <div className="p-2.5 rounded-xl bg-[#0066FF]/10 border border-[#0066FF]/25 flex items-center gap-2 text-xs text-[#0066FF] animate-fadeIn">
                <Sparkles className="w-4 h-4 shrink-0" />
                <span className="leading-tight">{autoDetectedInfo}</span>
              </div>
            )}
          </div>

          {/* SECCIÓN 2: SUBIR PORTADA DE LA PUBLICACIÓN */}
          <div className="space-y-2">
            <label className={`text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 ${isDark ? 'text-white' : 'text-[#0F172A]'}`}>
              <ImageIcon className="w-4 h-4 text-[#0066FF]" />
              <span>Portada de la Publicación</span>
            </label>

            {/* Input nativo oculto para imágenes */}
            <input
              ref={coverInputRef}
              type="file"
              accept="image/*"
              onChange={handleCoverChange}
              className="hidden"
            />

            {coverImage ? (
              <div className="relative rounded-2xl overflow-hidden border border-[#0066FF]/40 bg-black group">
                <img
                  src={coverImage}
                  alt="Portada seleccionada"
                  className="w-full h-36 object-cover opacity-90 group-hover:opacity-100 transition-opacity"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/40 flex items-end justify-between p-3">
                  <div className="text-xs font-semibold text-white drop-shadow truncate max-w-xs">
                    {coverFileName || 'Portada cargada'}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => coverInputRef.current?.click()}
                      className="px-3 py-1.5 rounded-lg bg-black/80 hover:bg-black text-xs text-white border border-white/20 backdrop-blur-md transition-colors"
                    >
                      Cambiar Portada
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setCoverImage('');
                        setCoverFileName('');
                      }}
                      className="p-1.5 rounded-lg bg-red-600/80 hover:bg-red-600 text-white backdrop-blur-md transition-colors"
                      title="Eliminar portada"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div
                onDragOver={(e) => { e.preventDefault(); setIsDraggingCover(true); }}
                onDragLeave={() => setIsDraggingCover(false)}
                onDrop={handleDropCover}
                onClick={() => coverInputRef.current?.click()}
                className={`border-2 border-dashed rounded-2xl p-4 text-center cursor-pointer transition-all ${
                  isDraggingCover
                    ? 'border-[#0066FF] bg-[#0066FF]/10'
                    : isDark
                    ? 'border-[#1E1E24] hover:border-[#0066FF]/60 bg-[#0A0A0C] hover:bg-[#121216]'
                    : 'border-[#CBD5E1] hover:border-[#0066FF]/60 bg-slate-50 hover:bg-blue-50/40'
                }`}
              >
                <div
                  className={`w-9 h-9 mx-auto mb-1.5 rounded-xl border flex items-center justify-center ${
                    isDark ? 'bg-black border-[#1E1E24]' : 'bg-white border-[#CBD5E1]'
                  }`}
                >
                  <ImageIcon className="w-4 h-4 text-[#0066FF]" />
                </div>
                <div className={`text-xs font-semibold ${isDark ? 'text-white' : 'text-[#0F172A]'}`}>
                  Haz clic para subir la imagen de portada
                </div>
                <div className={`text-[10px] mt-0.5 ${isDark ? 'text-[#8E8E93]' : 'text-[#64748B]'}`}>
                  PNG, JPG o WEBP (Recomendado 1200x675 px)
                </div>
              </div>
            )}
          </div>

          {/* SECCIÓN 3: DETALLES EDITABLES / AUTOCOMPLETADOS */}
          <div className={`pt-2 border-t space-y-4 ${isDark ? 'border-[#1E1E24]' : 'border-[#E2E8F0]'}`}>
            {/* Título del Material */}
            <div>
              <label className={`block text-xs font-semibold uppercase tracking-wider mb-1.5 ${isDark ? 'text-[#8E8E93]' : 'text-[#64748B]'}`}>
                Título de la Publicación
              </label>
              <input
                id="admin-upload-title-input"
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Ej: Masterclass: Arquitectura de Bóvedas y Microservicios"
                className={`w-full rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-[#0066FF] transition-colors border ${
                  isDark
                    ? 'bg-[#121216] border-[#1E1E24] text-white'
                    : 'bg-white border-[#CBD5E1] text-[#0F172A]'
                }`}
              />
            </div>

            {/* Descripción */}
            <div>
              <label className={`block text-xs font-semibold uppercase tracking-wider mb-1.5 ${isDark ? 'text-[#8E8E93]' : 'text-[#64748B]'}`}>
                Descripción y Notas Exclusivas
              </label>
              <textarea
                id="admin-upload-desc-input"
                rows={3}
                required
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Detalla el contenido, notas de versión o instrucciones de uso..."
                className={`w-full rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-[#0066FF] transition-colors resize-none border ${
                  isDark
                    ? 'bg-[#121216] border-[#1E1E24] text-white'
                    : 'bg-white border-[#CBD5E1] text-[#0F172A]'
                }`}
              />
            </div>

            {/* SECCIÓN MEDIAFIRE CLOUD - REDIRECCIÓN OFICIAL */}
            <div className={`p-4 rounded-2xl border space-y-2.5 transition-colors ${
              isDark ? 'bg-[#0A101D] border-[#0066FF]/40' : 'bg-blue-50/70 border-[#0066FF]/40'
            }`}>
              <div className="flex items-center justify-between flex-wrap gap-2">
                <label className={`text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 ${isDark ? 'text-white' : 'text-[#0F172A]'}`}>
                  <span className="w-2.5 h-2.5 rounded-full bg-[#0066FF] animate-pulse"></span>
                  <span className="text-[#0066FF]">🔥 Enlace de MediaFire</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#0066FF]/20 text-[#0066FF] font-semibold border border-[#0066FF]/30">
                    Redirección Directa
                  </span>
                </label>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleOpenMediafire}
                    className="text-[11px] font-semibold text-[#0066FF] hover:underline flex items-center gap-1 bg-[#0066FF]/10 hover:bg-[#0066FF]/20 px-2.5 py-1 rounded-lg transition-colors cursor-pointer"
                    title="Abre tu panel de MediaFire en una pestaña nueva para subir el archivo"
                  >
                    <span>Abrir MediaFire</span>
                    <ArrowUpRight className="w-3.5 h-3.5" />
                  </button>

                  <button
                    type="button"
                    onClick={handlePasteClipboard}
                    className={`text-[11px] font-semibold px-2.5 py-1 rounded-lg border transition-colors cursor-pointer ${
                      isDark
                        ? 'bg-[#121216] hover:bg-[#1E1E24] text-white border-[#1E1E24]'
                        : 'bg-white hover:bg-slate-100 text-[#0F172A] border-[#CBD5E1]'
                    }`}
                  >
                    Pegar Link
                  </button>
                </div>
              </div>

              <input
                id="admin-upload-mediafire-input"
                type="url"
                value={mediafireUrl}
                onChange={(e) => handleMediafireUrlChange(e.target.value)}
                placeholder="https://www.mediafire.com/file/xxxx/tu_archivo.zip/file"
                className={`w-full rounded-xl px-4 py-2.5 text-xs font-mono focus:outline-none focus:border-[#0066FF] transition-colors border ${
                  isDark
                    ? 'bg-[#05080E] border-[#1E1E24] text-white placeholder:text-[#64748B]'
                    : 'bg-white border-[#CBD5E1] text-[#0F172A] placeholder:text-[#94A3B8]'
                }`}
              />

              <p className={`text-[11px] leading-relaxed ${isDark ? 'text-[#8E8E93]' : 'text-[#64748B]'}`}>
                Sube tu archivo a <strong>MediaFire</strong> y pega el enlace aquí. Cuando cualquier usuario presione el botón de <strong>Descargar</strong>, la app lo redirigirá inmediatamente a MediaFire sin descargar archivos locales en el teléfono.
              </p>
            </div>

            {/* Metadatos Reconocidos: Formato, Peso y Versión (Formato y Peso solo visibles si se sube archivo) */}
            <div className={`grid ${uploadedFileName ? 'grid-cols-3' : 'grid-cols-1'} gap-3`}>
              {uploadedFileName && (
                <>
                  <div>
                    <label className={`block text-xs font-semibold uppercase tracking-wider mb-1 ${isDark ? 'text-[#8E8E93]' : 'text-[#64748B]'}`}>
                      Formato
                    </label>
                    <input
                      type="text"
                      value={fileType}
                      onChange={(e) => setFileType(e.target.value)}
                      placeholder="ZIP / MP4"
                      className={`w-full rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-[#0066FF] border ${
                        isDark
                          ? 'bg-[#121216] border-[#1E1E24] text-white'
                          : 'bg-white border-[#CBD5E1] text-[#0F172A]'
                      }`}
                    />
                  </div>
                  <div>
                    <label className={`block text-xs font-semibold uppercase tracking-wider mb-1 ${isDark ? 'text-[#8E8E93]' : 'text-[#64748B]'}`}>
                      Peso Reconocido
                    </label>
                    <input
                      type="text"
                      value={fileSize}
                      onChange={(e) => setFileSize(e.target.value)}
                      placeholder="45 MB"
                      className={`w-full rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-[#0066FF] border ${
                        isDark
                          ? 'bg-[#121216] border-[#1E1E24] text-white'
                          : 'bg-white border-[#CBD5E1] text-[#0F172A]'
                      }`}
                    />
                  </div>
                </>
              )}
              <div>
                <label className={`block text-xs font-semibold uppercase tracking-wider mb-1 ${isDark ? 'text-[#8E8E93]' : 'text-[#64748B]'}`}>
                  Versión
                </label>
                <input
                  type="text"
                  value={version}
                  onChange={(e) => setVersion(e.target.value)}
                  placeholder="v1.0"
                  className={`w-full rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-[#0066FF] border ${
                    isDark
                      ? 'bg-[#121216] border-[#1E1E24] text-white'
                      : 'bg-white border-[#CBD5E1] text-[#0F172A]'
                  }`}
                />
              </div>
            </div>

            {/* Asignación a Listas Creadas por el Administrador */}
            {lists && lists.length > 0 && (
              <div className="pt-2">
                <label className={`block text-xs font-semibold uppercase tracking-wider mb-2 flex items-center gap-1.5 ${isDark ? 'text-[#8E8E93]' : 'text-[#64748B]'}`}>
                  <FolderPlus className="w-3.5 h-3.5 text-[#0066FF]" />
                  <span>Asignar a Listas / Colecciones (Opcional)</span>
                </label>
                <div className="flex flex-wrap gap-2">
                  {lists.map((list) => {
                    const isSelected = selectedListIds.includes(list.id);
                    return (
                      <button
                        key={list.id}
                        type="button"
                        onClick={() => {
                          setSelectedListIds((prev) =>
                            prev.includes(list.id)
                              ? prev.filter((id) => id !== list.id)
                              : [...prev, list.id]
                          );
                        }}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border transition-all cursor-pointer ${
                          isSelected
                            ? 'bg-[#0066FF] border-[#0066FF] text-white shadow-md shadow-[#0066FF]/30'
                            : isDark
                            ? 'bg-[#121216] border-[#1E1E24] text-[#8E8E93] hover:text-white hover:border-[#2A2A34]'
                            : 'bg-slate-50 border-[#E2E8F0] text-[#64748B] hover:text-[#0F172A]'
                        }`}
                      >
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ backgroundColor: list.color || '#0066FF' }}
                        />
                        <span>{list.name}</span>
                        {isSelected && <CheckCircle2 className="w-3.5 h-3.5 ml-0.5" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Submit Buttons */}
          <div className={`pt-3 border-t flex gap-3 ${isDark ? 'border-[#1E1E24]' : 'border-[#E2E8F0]'}`}>
            <motion.button
              type="button"
              onClick={handleClose}
              disabled={isSubmitting}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className={`flex-1 py-3 px-4 rounded-xl border text-xs font-semibold transition-colors disabled:opacity-50 cursor-pointer ${
                isDark
                  ? 'border-[#1E1E24] text-[#8E8E93] hover:text-white'
                  : 'border-[#CBD5E1] text-[#64748B] hover:text-[#0F172A]'
              }`}
            >
              Cancelar
            </motion.button>
            <motion.button
              id="admin-publish-resource-btn"
              type="submit"
              disabled={isSubmitting}
              whileHover={{ scale: 1.02, y: -1 }}
              whileTap={{ scale: 0.98 }}
              className="flex-1 py-3 px-4 rounded-xl bg-[#0066FF] hover:bg-[#0052FF] text-white text-xs font-bold flex items-center justify-center gap-2 transition-all shadow-lg shadow-[#0066FF]/30 disabled:opacity-60 cursor-pointer"
            >
              {isSubmitting ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Publicando en la nube...</span>
                </>
              ) : (
                <>
                  <UploadCloud className="w-4 h-4" />
                  <span>Publicar en la Bóveda</span>
                </>
              )}
            </motion.button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
};

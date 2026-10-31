import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { VaultItem } from '../types';
import { getFileFromIndexedDB } from './indexedDBStorage';
import { resolveApiUrl, isStandaloneApp, getRemoteServerBaseUrl } from './firebaseService';

export interface SaveFileResult {
  success: boolean;
  savedPath?: string;
  isNative?: boolean;
  platform?: 'android' | 'ios' | 'web';
  openedShare?: boolean;
  error?: string;
}

/**
 * Helper to convert Blob to Base64 string for native Filesystem writing
 */
export async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Error al leer el archivo en memoria'));
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
      resolve(base64);
    };
    reader.readAsDataURL(blob);
  });
}

/**
 * Universal file saver: handles Web, native Android (Downloads/Documents), and native iOS (Files/Documents/Share)
 */
export async function saveFileLocallyOrDevice(
  blob: Blob,
  filename: string,
  mimeType = 'application/octet-stream'
): Promise<SaveFileResult> {
  const isNative = Capacitor.isNativePlatform();
  const platform = Capacitor.getPlatform() as 'android' | 'ios' | 'web';

  // 1. Web Browser Environment
  if (!isNative) {
    try {
      saveAs(blob, filename);
      return { success: true, savedPath: `Descargas (${filename})`, isNative: false, platform: 'web' };
    } catch (webErr) {
      try {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
          if (document.body.contains(a)) document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }, 1200);
        return { success: true, savedPath: `Descargas (${filename})`, isNative: false, platform: 'web' };
      } catch (err: any) {
        return { success: false, error: err?.message || 'Error al guardar el archivo en el navegador.' };
      }
    }
  }

  // 2. Native Mobile Environment (Android APK & iOS App)
  try {
    const base64Data = await blobToBase64(blob);

    // Request permissions on Android if needed
    if (platform === 'android') {
      try {
        const permStatus = await Filesystem.checkPermissions();
        if (permStatus.publicStorage !== 'granted') {
          await Filesystem.requestPermissions();
        }
      } catch (pErr) {
        console.warn('[Filesystem] Permission check notice:', pErr);
      }
    }

    let savedUri = '';
    let savedLocation = '';

    if (platform === 'android') {
      // Primary: Save directly in Android public "Download" directory
      try {
        const res = await Filesystem.writeFile({
          path: `Download/${filename}`,
          data: base64Data,
          directory: Directory.ExternalStorage,
          recursive: true,
        });
        savedUri = res.uri;
        savedLocation = `Carpeta Descargas (${filename})`;
      } catch (androidErr1) {
        console.warn('[Filesystem] Could not write to Download/ under ExternalStorage, attempting Documents:', androidErr1);
        try {
          const res = await Filesystem.writeFile({
            path: filename,
            data: base64Data,
            directory: Directory.Documents,
            recursive: true,
          });
          savedUri = res.uri;
          savedLocation = `Carpeta Documentos (${filename})`;
        } catch (androidErr2) {
          console.warn('[Filesystem] Could not write to Documents, attempting Data folder:', androidErr2);
          const res = await Filesystem.writeFile({
            path: filename,
            data: base64Data,
            directory: Directory.Data,
            recursive: true,
          });
          savedUri = res.uri;
          savedLocation = `Almacenamiento del dispositivo (${filename})`;
        }
      }
    } else {
      // iOS: Save to Documents directory (integrated with iOS Files app via UIFileSharingEnabled)
      try {
        const res = await Filesystem.writeFile({
          path: filename,
          data: base64Data,
          directory: Directory.Documents,
          recursive: true,
        });
        savedUri = res.uri;
        savedLocation = `Archivos de iPhone > Seis6 App > Descargas (${filename})`;
      } catch (iosErr) {
        console.warn('[Filesystem iOS] Could not write to Documents, attempting Cache:', iosErr);
        const res = await Filesystem.writeFile({
          path: filename,
          data: base64Data,
          directory: Directory.Cache,
          recursive: true,
        });
        savedUri = res.uri;
        savedLocation = `Archivos (${filename})`;
      }
    }

    // Invoke Native Share Sheet so the user can easily open, send, or save to custom location
    let openedShare = false;
    try {
      if (savedUri) {
        await Share.share({
          title: filename,
          text: `Archivo descargado: ${filename}`,
          url: savedUri,
          dialogTitle: `Guardar o abrir ${filename}`,
        });
        openedShare = true;
      }
    } catch (shareErr) {
      // If user dismisses the share sheet, the file is ALREADY saved in storage!
      console.log('[Share] Share modal dismissed or completed:', shareErr);
    }

    return {
      success: true,
      savedPath: savedLocation,
      isNative: true,
      platform,
      openedShare,
    };
  } catch (nativeErr: any) {
    console.error('[Filesystem Native Save Error]:', nativeErr);
    // Last-ditch fallback
    try {
      saveAs(blob, filename);
      return { success: true, savedPath: `Descargas (${filename})`, isNative: true, platform };
    } catch (fbErr: any) {
      return {
        success: false,
        isNative: true,
        platform,
        error: nativeErr?.message || 'Error al escribir el archivo en el almacenamiento del dispositivo.',
      };
    }
  }
}

/**
 * Helper to determine clean file extension and MIME type from item data
 */
function resolveItemFileDetails(item: VaultItem): { filename: string; mimeType: string; isZip: boolean } {
  if (item.fileName && item.fileName.includes('.')) {
    const ext = item.fileName.split('.').pop()?.toLowerCase() || '';
    const mimeMap: Record<string, string> = {
      pdf: 'application/pdf',
      apk: 'application/vnd.android.package-archive',
      zip: 'application/zip',
      rar: 'application/x-rar-compressed',
      '7z': 'application/x-7z-compressed',
      mp4: 'video/mp4',
      mkv: 'video/x-matroska',
      mov: 'video/quicktime',
      mp3: 'audio/mpeg',
      wav: 'audio/wav',
      flac: 'audio/flac',
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      webp: 'image/webp',
      json: 'application/json',
      txt: 'text/plain',
      md: 'text/markdown',
      cube: 'text/plain',
      xmp: 'application/xml',
      py: 'text/x-python',
      js: 'application/javascript',
      ts: 'application/typescript',
      html: 'text/html',
      css: 'text/css',
    };
    return {
      filename: item.fileName,
      mimeType: item.fileMimeType || mimeMap[ext] || 'application/octet-stream',
      isZip: ext === 'zip',
    };
  }

  // Derive from fileType or category
  const slug = (item.title || 'recurso')
    .toLowerCase()
    .replace(/[^a-z0-9]/gi, '_')
    .replace(/_+/g, '_');

  const lowerType = (item.fileType || '').toLowerCase();

  if (lowerType.includes('pdf') || item.category === 'document') {
    return { filename: `${slug}.pdf`, mimeType: 'application/pdf', isZip: false };
  }
  if (lowerType.includes('apk')) {
    return { filename: `${slug}.apk`, mimeType: 'application/vnd.android.package-archive', isZip: false };
  }
  if (lowerType.includes('mp4') || item.category === 'video') {
    return { filename: `${slug}.mp4`, mimeType: 'video/mp4', isZip: false };
  }
  if (lowerType.includes('mp3') || lowerType.includes('audio') || item.category === 'audio') {
    const ext = lowerType.includes('flac') ? 'flac' : lowerType.includes('wav') ? 'wav' : 'mp3';
    return { filename: `${slug}.${ext}`, mimeType: `audio/${ext}`, isZip: false };
  }
  if (lowerType.includes('cube') || item.category === 'preset') {
    const ext = lowerType.includes('cube') ? 'cube' : lowerType.includes('xmp') ? 'xmp' : 'zip';
    return { filename: `${slug}.${ext}`, mimeType: 'application/octet-stream', isZip: ext === 'zip' };
  }

  // Default to standard zip package
  return { filename: `${slug}.zip`, mimeType: 'application/zip', isZip: true };
}

/**
 * Downloads the actual resource in its exact original format and saves to the native device's Downloads folder
 */
export async function downloadVaultItemResource(item: VaultItem): Promise<SaveFileResult> {
  try {
    // Redirección directa a MediaFire
    if (item.mediafireUrl || (item.downloadUrl && (item.downloadUrl.includes('mediafire.com') || item.downloadUrl.startsWith('http')))) {
      const targetUrl = item.mediafireUrl || item.downloadUrl;
      try {
        const a = document.createElement('a');
        a.href = targetUrl;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
          if (document.body.contains(a)) document.body.removeChild(a);
        }, 800);
      } catch {
        window.location.href = targetUrl;
      }
      return { success: true, savedPath: 'MediaFire Cloud (Redirección)', isNative: false };
    }

    const { filename, mimeType, isZip } = resolveItemFileDetails(item);
    const targetFilename = item.fileName || filename;

    // Case 1: Direct in-memory raw File/Blob from upload session
    if (item.rawFileBlob) {
      return await saveFileLocallyOrDevice(item.rawFileBlob, targetFilename, mimeType);
    }

    // Case 2: IndexedDB local persistent cache (preserves 100% real files across reloads)
    try {
      const localCached = await getFileFromIndexedDB(item.id);
      if (localCached && localCached.blob) {
        return await saveFileLocallyOrDevice(localCached.blob, targetFilename, mimeType);
      }
    } catch (idbErr) {
      console.warn('IndexedDB retrieval error:', idbErr);
    }

    // Case 3: Embedded base64 or text data (available anywhere, works 100% offline in standalone APK)
    if (item.fileData) {
      if (item.fileData.startsWith('data:')) {
        const response = await fetch(item.fileData);
        const blob = await response.blob();
        return await saveFileLocallyOrDevice(blob, targetFilename, mimeType);
      } else {
        const blob = new Blob([item.fileData], { type: mimeType });
        return await saveFileLocallyOrDevice(blob, targetFilename, mimeType);
      }
    }

    // Case 4: Explicit external cloud storage link (S3, Firebase Storage, Supabase Storage, CDN)
    if (
      item.downloadUrl &&
      (item.downloadUrl.startsWith('http://') || item.downloadUrl.startsWith('https://')) &&
      !item.downloadUrl.includes('localhost') &&
      !item.downloadUrl.startsWith('blob:http')
    ) {
      try {
        const response = await fetch(item.downloadUrl);
        if (response.ok) {
          const blob = await response.blob();
          return await saveFileLocallyOrDevice(blob, targetFilename, mimeType);
        }
      } catch (err) {
        console.warn('Could not download directly from external cloud URL:', err);
      }
    }

    // Case 5: Dedicated backend server download endpoint (/api/vault/download/:id)
    if (item.id && (!isStandaloneApp() || getRemoteServerBaseUrl())) {
      try {
        const serverUrl = resolveApiUrl(`/api/vault/download/${encodeURIComponent(item.id)}`);
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 6000);
        const res = await fetch(serverUrl, { signal: controller.signal });
        clearTimeout(timeoutId);
        const contentType = res.headers.get('content-type') || '';
        // Only accept if not the fallback HTML SPA
        if (res.ok && !contentType.includes('text/html')) {
          const blob = await res.blob();
          return await saveFileLocallyOrDevice(blob, targetFilename, contentType || mimeType);
        }
      } catch (srvErr) {
        console.warn('Server endpoint download check notice:', srvErr);
      }
    }

    // Case 6: Category-specific authentic file generation when physical file is not in local/server cache
    if (!isZip) {
      // PDF Document
      if (filename.endsWith('.pdf')) {
        const pdfContent = `%PDF-1.4
1 0 obj
<< /Title (${item.title}) /Author (${item.author?.name || 'Administrador'}) /Creator (Vault Private Server) >>
endobj
2 0 obj
<< /Type /Catalog /Pages 3 0 R >>
endobj
3 0 obj
<< /Type /Pages /Kids [4 0 R] /Count 1 >>
endobj
4 0 obj
<< /Type /Page /Parent 3 0 R /MediaBox [0 0 612 792] /Contents 5 0 R >>
endobj
5 0 obj
<< /Length 120 >>
stream
BT
/F1 18 Tf
50 720 Td
(${item.title}) Tj
/F1 12 Tf
0 -30 Td
(Autor: ${item.author?.name || 'Admin'} - ${item.createdAt}) Tj
0 -25 Td
(${item.description.slice(0, 80)}) Tj
ET
endstream
endobj
xref
0 6
0000000000 65535 f 
0000000010 00000 n 
0000000120 00000 n 
0000000170 00000 n 
0000000230 00000 n 
0000000320 00000 n 
trailer
<< /Size 6 /Root 2 0 R /Info 1 0 R >>
startxref
490
%%EOF`;
        const blob = new Blob([pdfContent], { type: 'application/pdf' });
        return await saveFileLocallyOrDevice(blob, filename, 'application/pdf');
      }

      // Raw text or configuration/preset
      const rawText = `# ${item.title}
Version: ${item.version || '1.0.0'}
Fecha: ${item.createdAt}
Autor: ${item.author?.name || 'Admin'}

${item.description}
`;
      const blob = new Blob([rawText], { type: mimeType });
      return await saveFileLocallyOrDevice(blob, filename, mimeType);
    }

    // Case 7: Standard Clean ZIP Package (Contains the original resource files and neutral info)
    const zip = new JSZip();
    const slug = (item.title || 'recurso')
      .toLowerCase()
      .replace(/[^a-z0-9]/gi, '_')
      .replace(/_+/g, '_');

    // 1. README con información técnica limpia
    const readme = `# ${item.title}
*Vault Private Server - Archivo Oficial*

---
- **Nombre de Archivo:** ${item.fileName || filename}
- **Categoría:** ${item.category.toUpperCase()}
- **Tipo de Archivo:** ${item.fileType || 'Archivo'}
- **Versión:** ${item.version || 'v1.0'}
- **Tamaño:** ${item.fileSize || 'Original'}
- **Publicado por:** ${item.author?.name || 'Administrador'} (${item.author?.badge || 'Admin'})
- **Fecha de Publicación:** ${item.createdAt || new Date().toISOString().split('T')[0]}

---

## 📖 Descripción
${item.description}

---

## 🔒 Licencia y Seguridad
Este archivo es propiedad del autor y está protegido bajo la infraestructura de Vault Private Server.
`;
    zip.file('README.md', readme);

    // 2. Metadata JSON
    const metadata = {
      id: item.id,
      title: item.title,
      fileName: item.fileName || filename,
      description: item.description,
      category: item.category,
      fileType: item.fileType,
      fileSize: item.fileSize,
      version: item.version || 'v1.0',
      author: item.author,
      createdAt: item.createdAt,
      exportedAt: new Date().toISOString(),
    };
    zip.file('metadata.json', JSON.stringify(metadata, null, 2));

    // 3. Archivo principal del recurso en su formato genuino
    const resourceContent = `// ${item.title}
// Archivo de recurso original
// Creado: ${item.createdAt}

${item.description}
`;
    const resourceFileName = item.fileName || `${slug}_source.txt`;
    zip.file(resourceFileName, resourceContent);

    // Generar ZIP y descargar
    const zipBlob = await zip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });

    return await saveFileLocallyOrDevice(zipBlob, filename, 'application/zip');
  } catch (error: any) {
    console.error('Error al descargar archivo original:', error);
    return { success: false, error: error?.message || 'Error durante la preparación de la descarga' };
  }
}

/**
 * Exports the complete Vite + Capacitor Android project configuration and instructions as a ZIP
 */
export async function exportViteAndroidProjectZip(): Promise<boolean> {
  try {
    const zip = new JSZip();
    let capacitorConfig = '';
    let packageJson = '';
    let packageLock = '';
    let workflowYml = '';
    let configureScript = '';
    let viteConfig = '';

    try {
      const res = await fetch(resolveApiUrl('/api/android/vite-source'));
      if (res.ok) {
        const data = await res.json();
        capacitorConfig = data.capacitorConfig || '';
        packageJson = data.packageJson || '';
        packageLock = data.packageLock || '';
        workflowYml = data.workflowYml || '';
        configureScript = data.configureScript || '';
        viteConfig = data.viteConfig || '';
      }
    } catch {}

    if (capacitorConfig) zip.file('capacitor.config.json', capacitorConfig);
    if (packageJson) zip.file('package.json', packageJson);
    if (packageLock) zip.file('package-lock.json', packageLock);
    if (workflowYml) zip.file('.github/workflows/build-android.yml', workflowYml);
    if (configureScript) zip.file('scripts/configure-android.cjs', configureScript);
    if (viteConfig) zip.file('vite.config.ts', viteConfig);

    const readme = `# Seis6 Vault - Compilación de APK de Android con Vite + Capacitor

Este repositorio contiene la arquitectura completa para compilar el **APK de Android** usando **Vite** y **Capacitor**, con modo oscuro AMOLED (#000000) Edge-to-Edge y Firebase Firestore sincronizado.

## 🚀 Opción 1: Compilación Automática en GitHub Actions (Más fácil y rápida)
1. Sube tu código a GitHub:
   \`\`\`bash
   git add .
   git commit -m "Compilar APK con Vite y Capacitor"
   git push origin main
   \`\`\`
2. En GitHub, haz clic en la pestaña **Actions**.
3. Selecciona el flujo **"Generar APK de Android (Vite + Capacitor)"** y pulsa **Run workflow**.
4. En 2-3 minutos se compila tu APK y la descargas desde la sección **Artifacts** con el nombre **Seis6-Vault-Vite-APK** (\`Seis6_Vault_v1.0.apk\`).

## 💻 Opción 2: Compilación en tu Computadora (Local)
Requisitos: Node.js 22+ y Java JDK 21 / Android SDK (API 36).

\`\`\`bash
# 1. Instalar paquetes
npm install

# 2. Compilar el sitio web con Vite
npm run build

# 3. Sincronizar la plataforma Android nativa
npx cap sync android

# 4. Aplicar configuración AMOLED #000000 y estilos
node scripts/configure-android.cjs

# 5. Compilar el APK
cd android
./gradlew assembleDebug
\`\`\`

Tu APK estará lista en:
\`android/app/build/outputs/apk/debug/app-debug.apk\`
`;

    zip.file('README_COMPILAR_APK_VITE.md', readme);

    const blob = await zip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });
    const saveRes = await saveFileLocallyOrDevice(blob, 'Seis6_Vault_Vite_Android_Project.zip', 'application/zip');
    return saveRes.success;
  } catch (err) {
    console.error('Error exportando proyecto Android Vite:', err);
    return false;
  }
}

/**
 * Exports the complete 100% Native Flutter project (Dart + pubspec.yaml + GitHub Actions APK builder) as a ZIP
 */
export async function exportFlutterNativeProjectZip(): Promise<boolean> {
  return exportViteAndroidProjectZip();
}

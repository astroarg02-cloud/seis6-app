import { VaultItem, VaultList, UserProfile } from '../types';

export const ADMIN_AUTHORIZED_EMAILS = [
  'astroarg02@gmail.com',
  'cuentaninja989@gmail.com',
  'creadorffx@gmail.com',
  'admin@vault.private',
];
export const ADMIN_AUTHORIZED_EMAIL = 'astroarg02@gmail.com';
export const ADMIN_SECURITY_KEY = '360';

export const isAuthorizedAdminKey = (key?: string | null): boolean => {
  if (!key) return false;
  return key.trim() === ADMIN_SECURITY_KEY;
};

export const isAuthorizedAdminEmail = (email?: string | null): boolean => {
  if (!email) return false;
  const clean = email.trim().toLowerCase();
  return ADMIN_AUTHORIZED_EMAILS.some((adm) => adm.toLowerCase() === clean);
};

export const INITIAL_ADMIN_USER: UserProfile = {
  uid: 'admin_master_astro',
  email: 'astroarg02@gmail.com',
  displayName: 'Seis6 Mod',
  role: 'admin',
  joinedAt: '2025-01-01',
  tier: 'Bóveda Diamante',
  membershipStatus: 'none',
  bio: 'Owner Oficial del Sei6 🛠️',
  phone: '+54 9 11 6554-6038',
  customStatus: 'Modo Administrador',
  instagram: 'spig9tv',
  avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
};

export const INITIAL_MEMBER_USER: UserProfile = {
  uid: 'vip_user_449',
  email: 'vip.member@privatehub.io',
  displayName: 'Alex Vance',
  role: 'vip_member',
  joinedAt: '2025-02-14',
  tier: 'Invitado',
  membershipStatus: 'none',
  avatarUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80',
};

export const INITIAL_VAULT_ITEMS: VaultItem[] = [
  {
    id: 'vault-res-1787518251503',
    title: 'BIENVENIDOS A LA APP SEIS6 VAULT 😍',
    description: 'En esta aplicación oficial encontrarás todo tipo de recursos y archivos para iOS y Android totalmente optimizados',
    category: 'code',
    fileType: '',
    fileSize: '',
    downloadUrl: '',
    coverImage: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=600&auto=format&fit=crop&q=80',
    createdAt: '2026-08-23',
    likesCount: 3,
    likedBy: ['admin_master_astro', 'user_dGptYXlhMDA5OUBn', 'user_am9zZXRtejI0MDRA'],
    version: 'v1.0',
    author: {
      name: 'Administrador (astroarg02)',
      badge: 'ADMIN ROOT',
    },
    comments: [],
  },
  {
    id: 'vault-res-1787520057677',
    title: 'REGEDIT 66👹📂',
    description: 'Regedit con alta sensibilidad para Android y emuladores',
    category: 'code',
    fileType: 'REG Archivo',
    fileSize: '1.8 KB',
    downloadUrl: '',
    coverImage: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=600&auto=format&fit=crop&q=80',
    createdAt: '2026-08-23',
    likesCount: 2,
    likedBy: ['admin_master_astro', 'user_dGptYXlhMDA5OUBn'],
    version: 'v1.0',
    author: {
      name: 'Administrador (astroarg02)',
      badge: 'ADMIN ROOT',
    },
    comments: [],
  },
  {
    id: 'vault-res-1787520090540',
    title: 'Regedit iOS 66',
    description: 'Configuración y optimización de sensibilidad exclusiva para dispositivos iOS',
    category: 'code',
    fileType: 'REG Archivo',
    fileSize: '2.2 KB',
    downloadUrl: '',
    coverImage: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=600&auto=format&fit=crop&q=80',
    createdAt: '2026-08-23',
    likesCount: 2,
    likedBy: ['admin_master_astro', 'user_dGptYXlhMDA5OUBn'],
    version: 'v1.0',
    author: {
      name: 'Administrador (astroarg02)',
      badge: 'ADMIN ROOT',
    },
    comments: [],
  },
  {
    id: 'vault-res-1787520163631',
    title: 'Aimbot modificado66',
    description: 'Este panel hará que tu sensi mejore casi un 80%',
    category: 'code',
    fileType: '',
    fileSize: '',
    downloadUrl: '',
    coverImage: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=600&auto=format&fit=crop&q=80',
    createdAt: '2026-08-23',
    likesCount: 2,
    likedBy: ['admin_master_astro', 'user_am9zZXRtejI0MDRA'],
    version: 'v1.0',
    author: {
      name: 'Administrador (astroarg02)',
      badge: 'ADMIN ROOT',
    },
    comments: [],
  },
];

export const INITIAL_VAULT_LISTS: VaultList[] = [
  {
    id: 'list-apps-systems',
    name: '📱 Archivos iOS & Android',
    description: 'Recursos, utilidades, tutoriales y aplicaciones exclusivas para dispositivos móviles.',
    icon: 'smartphone',
    color: '#0066FF',
    itemIds: [
      'vault-res-1787518251503',
      'vault-res-1787704059808-2e3t',
      'vault-res-1787969589328-nceg',
      'vault-res-1788001240182-pehh',
      'vault-res-1788729821011-8fj9',
      'vault-res-1788903595456-tnwo',
      'vault-res-1789670208740-xkmp',
      'vault-res-1789854353685-9xef',
    ],
    createdAt: '2026-08-23',
    createdBy: 'admin_master_astro',
  },
  {
    id: 'list-regedits-sensi',
    name: '⚡ Regedits y Sensibilidad',
    description: 'Configuraciones de máxima respuesta táctil, archivos REG, atajos, scripts y paneles optimizados.',
    icon: 'sliders',
    color: '#10B981',
    itemIds: [
      'vault-res-1787520057677',
      'vault-res-1787520090540',
      'vault-res-1787520163631',
      'vault-res-1788000924191-tan0',
      'vault-res-1788903151889-mnxs',
      'vault-res-1788903211431-nmxs',
      'vault-res-1788903978217-35wt',
      'vault-res-1788904111496-ufkv',
      'vault-res-1789670085068-jywx',
    ],
    createdAt: '2026-08-23',
    createdBy: 'admin_master_astro',
  },
];


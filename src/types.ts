export type UserRole = 'admin' | 'vip_member';

export type MembershipPlanType = 'monthly' | 'annual';
export type MembershipStatusType = 'active' | 'cancelled' | 'none';

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  role: UserRole;
  avatarUrl?: string;
  joinedAt: string;
  tier: 'Bóveda Diamante' | 'Acceso VIP' | 'Invitado';
  membershipPlan?: MembershipPlanType;
  membershipStatus?: MembershipStatusType;
  membershipExpiresAt?: string;
  subscribedAt?: string;
  lastPaymentAmount?: number;
  bio?: string;
  phone?: string;
  instagram?: string;
  customStatus?: string;
  updatedAt?: string;
}

export type ResourceCategory = 'video' | 'document' | 'audio' | 'preset' | 'code';

export interface VaultComment {
  id: string;
  userId: string;
  userDisplayName: string;
  userRole: UserRole;
  userTier: string;
  text: string;
  createdAt: string;
}

export interface VaultList {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  color?: string;
  itemIds: string[];
  createdAt: string;
  createdBy?: string;
}

export interface VaultItem {
  id: string;
  title: string;
  description: string;
  category: ResourceCategory;
  fileType: string;
  fileSize: string;
  downloadUrl: string;
  mediafireUrl?: string;
  coverImage: string;
  createdAt: string;
  likesCount: number;
  likedBy: string[]; // list of user UIDs
  comments: VaultComment[];
  isLockedForTier?: boolean;
  version?: string;
  fileName?: string;
  fileMimeType?: string;
  fileData?: string; // base64 or text content
  rawFileBlob?: Blob | File;
  listIds?: string[];
  author: {
    name: string;
    badge: string;
  };
}

export type ThemeMode = 'dark' | 'light';

export type BackendProvider = 'firebase' | 'supabase';

export interface SupabaseConfigState {
  supabaseUrl: string;
  supabaseAnonKey: string;
  isConnected: boolean;
}

export interface StoreProduct {
  id: string;
  name: string;
  description: string;
  category: 'smartphones' | 'audio' | 'accessories' | 'gaming' | string;
  price: number;
  originalPrice?: number;
  badge?: string;
  image: string;
  gallery?: string[];
  rating: number;
  reviewsCount: number;
  stock: number;
  stockText?: string;
  shipping: string;
  features: string[];
  specs?: Record<string, string>;
  isPopular?: boolean;
}

export type ReceiptStatus = 'pending' | 'approved' | 'rejected';

export interface PaymentReceipt {
  id: string;
  userId: string;
  userDisplayName: string;
  userEmail: string;
  userAvatar?: string;
  plan: MembershipPlanType;
  amount: number;
  currency: string;
  paymentMethod: string;
  referenceCode: string;
  receiptImageUrl: string;
  receiptFileName?: string;
  notes?: string;
  whatsappContact?: string;
  status: ReceiptStatus;
  createdAt: string;
  reviewedAt?: string;
  reviewedBy?: string;
  adminNote?: string;
  membershipStartsAt?: string;
  membershipExpiresAt?: string;
}


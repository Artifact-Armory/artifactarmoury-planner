// User types
export interface User {
  id: string;
  email: string;
  display_name: string;
  role: 'customer' | 'artist' | 'admin';
  account_status: 'active' | 'suspended' | 'banned';
  artist_name?: string;
  artist_bio?: string;
  artist_url?: string;
  stripe_account_id?: string;
  stripe_onboarding_complete?: boolean;
  created_at: Date;
  updated_at: Date;
}

// Model types
export interface Model {
  id: string;
  artist_id: string;
  name: string;
  description?: string;
  category: string;
  tags: string[];
  stl_file_path: string;
  glb_file_path?: string;
  thumbnail_path?: string;
  width?: number;
  depth?: number;
  height?: number;
  base_price: number;
  status: 'draft' | 'published' | 'archived' | 'flagged';
  visibility: 'public' | 'private' | 'unlisted';
  created_at: Date;
  updated_at: Date;
}

// Add more as needed
export interface PrintCostEstimate {
  volume_mm3: number;
  estimated_weight_g: number;
  estimated_material_cost: number;
  estimated_print_time_minutes: number;
  supports_required: boolean;
}

// Geometry/printing shared types used by services
export interface Vector3 { x: number; y: number; z: number }

export interface AABB { min: Vector3; max: Vector3 }

export interface Footprint { width: number; depth: number; height: number }

export interface PrintStats {
  estimated_weight_g?: number;
  estimated_print_time_minutes?: number;
  surface_area_mm2?: number;
  volume_mm3?: number;
  triangle_count?: number;
}

export interface FilePaths {
  stl: string;
  glb?: string;
  thumbnail?: string;
}

export interface PrintOptions {
  material?: 'pla' | 'abs' | 'petg' | 'resin' | 'tpu' | 'nylon';
  quality?: 'draft' | 'standard' | 'fine' | 'ultra';
  infill?: 0 | 10 | 15 | 20 | 30 | 50 | 100 | number;
}

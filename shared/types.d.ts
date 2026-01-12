export interface Artist {
    id: string;
    email: string;
    name: string;
    bio?: string;
    profile_image_url?: string;
    banner_image_url?: string;
    stripe_account_id?: string;
    stripe_onboarding_complete: boolean;
    invite_code?: string;
    status: 'invited' | 'active' | 'suspended';
    role: 'artist' | 'admin';
    commission_rate: number;
    created_at: string;
    updated_at: string;
}
export interface ArtistPublic {
    id: string;
    name: string;
    bio?: string;
    profile_image_url?: string;
    banner_image_url?: string;
    created_at: string;
}
export interface AuthResponse {
    token: string;
    artist: Omit<Artist, 'password_hash'>;
}
export interface LoginRequest {
    email: string;
    password: string;
}
export interface RegisterRequest {
    email: string;
    password: string;
    name: string;
    inviteCode: string;
}
export interface Vector3 {
    x: number;
    y: number;
    z: number;
}
export interface AABB {
    min: Vector3;
    max: Vector3;
}
export interface Footprint {
    width: number;
    depth: number;
    height: number;
}
export interface FilePaths {
    stl?: string;
    glb: string;
    thumbnail: string;
    additional_images?: string[];
}
export interface PrintRecommendations {
    material?: string[];
    layer_height?: number;
    infill?: number;
    supports?: boolean;
    build_plate_adhesion?: string;
}
export interface PrintStats {
    estimated_weight_g?: number;
    estimated_print_time_minutes?: number;
    surface_area_mm2?: number;
    volume_mm3?: number;
    triangle_count?: number;
}
export interface Asset {
    id: string;
    artist_id: string;
    name: string;
    description?: string;
    base_price: number;
    genre: string;
    categories: string[];
    tags: string[];
    aabb: AABB;
    footprint: Footprint;
    file_paths: FilePaths;
    print_recommendations: PrintRecommendations;
    print_stats: PrintStats;
    status: 'draft' | 'published' | 'archived';
    view_count: number;
    purchase_count: number;
    created_at: string;
    updated_at: string;
}
export interface AssetWithArtist extends Asset {
    artist: ArtistPublic;
}
export interface AssetUploadRequest {
    name: string;
    description?: string;
    base_price: number;
    genre: string;
    categories?: string[];
    tags?: string[];
    print_recommendations?: PrintRecommendations;
}
export interface AssetUpdateRequest {
    name?: string;
    description?: string;
    base_price?: number;
    genre?: string;
    categories?: string[];
    tags?: string[];
    print_recommendations?: PrintRecommendations;
    status?: 'draft' | 'published' | 'archived';
}
export interface BrowseFilters {
    genre?: string;
    categories?: string[];
    tags?: string[];
    min_price?: number;
    max_price?: number;
    artist_id?: string;
    search?: string;
    sort?: 'recent' | 'popular' | 'price_asc' | 'price_desc';
    page?: number;
    limit?: number;
}
export interface BrowseResponse {
    assets: AssetWithArtist[];
    total: number;
    page: number;
    limit: number;
    total_pages: number;
}
export interface PrintOptions {
    material?: 'pla' | 'resin' | 'abs';
    quality?: 'draft' | 'standard' | 'fine';
    color?: string;
    notes?: string;
}
export interface BasketItem {
    asset_id: string;
    quantity: number;
    printOptions?: PrintOptions;
}
export interface BasketItemWithAsset extends BasketItem {
    asset: AssetWithArtist;
}
export interface ShippingAddress {
    name: string;
    line1: string;
    line2?: string;
    city: string;
    state?: string;
    postal_code: string;
    country: string;
    phone?: string;
}
export interface OrderPricing {
    model_subtotal: number;
    platform_commission: number;
    print_subtotal: number;
    shipping: number;
    total: number;
}
export interface Order {
    id: string;
    order_number: string;
    user_email: string;
    user_name: string;
    shipping_address: ShippingAddress;
    items: BasketItem[];
    pricing: OrderPricing;
    status: 'pending_payment' | 'paid' | 'processing' | 'printing' | 'shipped' | 'delivered' | 'cancelled';
    print_farm_order_id?: string;
    stripe_payment_id?: string;
    paypal_payment_id?: string;
    tracking_number?: string;
    notes?: string;
    created_at: string;
    updated_at: string;
}
export interface OrderWithAssets extends Omit<Order, 'items'> {
    items: BasketItemWithAsset[];
}
export interface CheckoutRequest {
    user_email: string;
    user_name: string;
    shipping_address: ShippingAddress;
    items: BasketItem[];
    payment_method: 'stripe' | 'paypal';
}
export interface CheckoutResponse {
    order_id: string;
    order_number: string;
    client_secret?: string;
    approval_url?: string;
}
export interface TableConfig {
    width: number;
    depth: number;
    grid_size: number;
    background_color?: string;
    grid_color?: string;
}
export interface PlacedModel {
    id: string;
    asset_id: string;
    position: Vector3;
    rotation: number;
    scale?: number;
}
export interface LayoutData {
    models: PlacedModel[];
    camera_position?: Vector3;
    camera_target?: Vector3;
}
export interface UserTable {
    id: string;
    user_id: string | null;
    user_email?: string | null;
    name: string;
    description?: string | null;
    table_config: TableConfig;
    layout_data: LayoutData;
    share_token: string;
    is_public: boolean;
    share_code?: string;
    view_count: number;
    clone_count: number;
    status?: string;
    plan?: string;
    max_assets?: number;
    session_id?: string | null;
    created_at: string;
    updated_at: string;
}
export interface SaveTableRequest {
    name: string;
    description?: string;
    table_config: TableConfig;
    layout_data: LayoutData;
    is_public?: boolean;
    user_id?: string;
    user_email?: string;
    session_id?: string;
}
export interface ExampleTable {
    id: string;
    artist_id: string;
    name: string;
    description?: string;
    thumbnail_url?: string;
    table_config: TableConfig;
    layout_data: LayoutData;
    is_featured: boolean;
    view_count: number;
    created_at: string;
}
export interface ExampleTableWithArtist extends ExampleTable {
    artist: ArtistPublic;
}
export interface ArtistAnalytics {
    total_models: number;
    published_models: number;
    total_views: number;
    total_purchases: number;
    total_revenue: number;
    pending_payout: number;
    recent_orders: Order[];
    top_models: Array<{
        asset: Asset;
        views: number;
        purchases: number;
        revenue: number;
    }>;
}
export interface InviteCode {
    code: string;
    artist_id?: string;
    used: boolean;
    created_at: string;
    used_at?: string;
}
export interface GenerateInviteRequest {
    count?: number;
}
export interface GenerateInviteResponse {
    codes: string[];
}
export interface AuditLogEntry {
    id: string;
    user_id?: string;
    action: string;
    resource_type: string;
    resource_id?: string;
    details?: Record<string, any>;
    ip_address?: string;
    user_agent?: string;
    created_at: string;
}
export interface AdminStats {
    total_artists: number;
    active_artists: number;
    total_models: number;
    published_models: number;
    total_orders: number;
    total_revenue: number;
    platform_commission: number;
    pending_payouts: number;
}
export interface StripeTransfer {
    id: string;
    order_id: string;
    artist_id: string;
    stripe_transfer_id: string;
    amount: number;
    status: 'pending' | 'completed' | 'failed';
    created_at: string;
}
export interface StripeConnectOnboardingRequest {
    return_url: string;
    refresh_url: string;
}
export interface StripeConnectOnboardingResponse {
    url: string;
}
export interface ApiError {
    error: string;
    details?: any;
}
export interface ApiSuccess<T = any> {
    success: true;
    data: T;
    message?: string;
}
export interface PaginatedResponse<T> {
    items: T[];
    total: number;
    page: number;
    limit: number;
    total_pages: number;
}
export interface Purchase {
    id: string;
    user_email: string;
    asset_id: string;
    order_id: string;
    purchased_at: string;
}
export interface FileProcessingResult {
    success: boolean;
    file_paths?: FilePaths;
    aabb?: AABB;
    footprint?: Footprint;
    print_stats?: PrintStats;
    error?: string;
}
export interface FileProcessingJob {
    id: string;
    asset_id: string;
    status: 'pending' | 'processing' | 'completed' | 'failed';
    progress?: number;
    error?: string;
    created_at: string;
    updated_at: string;
}
export interface SearchSuggestion {
    type: 'asset' | 'artist' | 'tag' | 'category';
    value: string;
    label: string;
    metadata?: any;
}
export interface HealthResponse {
    status: 'ok' | 'error';
    timestamp: string;
    database?: 'connected' | 'disconnected';
    queue?: {
        active: number;
        waiting: number;
        failed: number;
    };
    environment?: string;
    version?: string;
    error?: string;
}
//# sourceMappingURL=types.d.ts.map

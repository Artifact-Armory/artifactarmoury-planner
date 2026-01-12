import { create } from 'zustand';
import apiClient from '../api/client';

const apiBase = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');

const toUploadUrl = (path?: string | null): string | undefined => {
  if (!path) return undefined;
  if (/^https?:\/\//i.test(path)) return path;
  const normalized = path.replace(/^\/+/, '').replace(/^uploads\//i, '');
  const urlPath = `/uploads/${normalized}`;
  return apiBase ? `${apiBase}${urlPath}` : urlPath;
};

const normaliseLibraryAsset = (
  raw: Partial<LibraryAsset> & {
    id?: string | null;
    asset_id?: string | null;
    model_id?: string | null;
    modelId?: string | null;
    artist_name?: string | null;
    artist_display_name?: string | null;
  },
  ownedAssetIds: Set<string>,
  ownedModelIds: Set<string>,
  fallbackModelId?: string,
): LibraryAsset => {
  const resolvedModelId = raw.modelId ?? raw.model_id ?? fallbackModelId ?? undefined;
  const resolvedId = raw.id ?? raw.asset_id ?? raw.file_ref ?? resolvedModelId ?? fallbackModelId ?? '';
  const owned =
    (!!resolvedId && ownedAssetIds.has(resolvedId)) ||
    (!!resolvedModelId && ownedModelIds.has(resolvedModelId));

  return {
    id: resolvedId,
    name: raw.name ?? '',
    description: raw.description ?? undefined,
    category: raw.category ?? undefined,
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    preview_url: toUploadUrl(raw.preview_url),
    thumbnail_path: toUploadUrl(raw.thumbnail_path),
    base_price: raw.base_price,
    view_count: raw.view_count,
    add_count: raw.add_count,
    use_count: raw.use_count,
    created_at: raw.created_at,
    updated_at: raw.updated_at,
    file_ref: raw.file_ref,
    glb_file_path: toUploadUrl(raw.glb_file_path),
    width: raw.width,
    depth: raw.depth,
    height: raw.height,
    model_id: raw.model_id ?? undefined,
    artist_name: raw.artist_name ?? null,
    artist_display_name: raw.artist_display_name ?? null,
    artistName: raw.artistName ?? raw.artist_name ?? raw.artist_display_name ?? null,
    modelId: resolvedModelId,
    owned,
  };
};

export interface LibraryAsset {
  id: string;
  name: string;
  description?: string;
  category?: string;
  tags?: string[];
  preview_url?: string;
  thumbnail_path?: string;
  base_price?: number;
  view_count?: number;
  add_count?: number;
  use_count?: number;
  created_at?: string;
  updated_at?: string;
  file_ref?: string;
  glb_file_path?: string;
  width?: number;
  depth?: number;
  height?: number;
  model_id?: string;
  artist_name?: string | null;
  artist_display_name?: string | null;
  artistName?: string | null;
  modelId?: string;
  owned?: boolean;
}

export interface TableLibraryAsset extends LibraryAsset {
  asset_id: string;
  quantity: number;
  last_used?: string;
}

export interface AssetSet {
  id: string;
  name: string;
  description?: string | null;
  is_public?: boolean;
  owner_name?: string | null;
  created_at?: string;
  updated_at?: string;
  assets: LibraryAsset[];
}

interface AssetListResponse {
  assets: LibraryAsset[];
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

interface LibraryState {
  assets: LibraryAsset[];
  tableAssets: Record<string, TableLibraryAsset[]>;
  sets: AssetSet[];
  ownedAssets: LibraryAsset[];
  ownedAssetIds: Set<string>;
  ownedModelIds: Set<string>;
  loading: boolean;
  error: string | null;
  fetchAssets: (params?: { search?: string; category?: string; page?: number; limit?: number }) => Promise<void>;
  fetchTableAssets: (tableId: string) => Promise<void>;
  addAssetToTable: (tableId: string, assetId: string, quantity?: number) => Promise<void>;
  removeAssetFromTable: (tableId: string, assetId: string) => Promise<void>;
  trackAssetUsage: (tableId: string, assetId: string) => Promise<void>;
  ensureAssetForModel: (modelId: string) => Promise<LibraryAsset | null>;
  fetchAssetSets: () => Promise<void>;
  fetchOwnedAssets: () => Promise<void>;
  removeAssetFromLibrary: (assetId: string) => Promise<void>;
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
  assets: [],
  tableAssets: {},
  sets: [],
  ownedAssets: [],
  ownedAssetIds: new Set(),
  ownedModelIds: new Set(),
  loading: false,
  error: null,

  async fetchAssets(params) {
    set({ loading: true, error: null });
    try {
      const response = await apiClient.get<AssetListResponse>('/api/library/assets', {
        params,
      });
      const payload = response.data ?? ({} as AssetListResponse);
      const { ownedAssetIds, ownedModelIds } = get();
      const assets = (payload.assets ?? []).map((asset) =>
        normaliseLibraryAsset(asset, ownedAssetIds, ownedModelIds, asset.model_id ?? undefined),
      );
      set({ assets, loading: false });
    } catch (error) {
      console.error('Failed to fetch assets', error);
      set({ error: 'Failed to load assets', loading: false });
    }
  },

  async fetchTableAssets(tableId: string) {
    if (!tableId) return;
    set({ loading: true, error: null });
    try {
      const response = await apiClient.get<{ assets: TableLibraryAsset[] }>(
        `/api/tables/${tableId}/library/assets`,
      );
      const { ownedAssetIds, ownedModelIds } = get();
      const assets = (response.data?.assets ?? []).map((asset) => {
        const normalized = normaliseLibraryAsset(
          asset,
          ownedAssetIds,
          ownedModelIds,
          asset.model_id ?? asset.modelId,
        );
        return {
          ...normalized,
          asset_id: asset.asset_id ?? normalized.id ?? asset.model_id ?? '',
          quantity: asset.quantity ?? 1,
          last_used: asset.last_used ?? undefined,
        };
      });
      set((state) => ({
        tableAssets: { ...state.tableAssets, [tableId]: assets },
        loading: false,
      }));
    } catch (error) {
      console.error('Failed to fetch table assets', error);
      set({ error: 'Failed to load table assets', loading: false });
    }
  },

  async addAssetToTable(tableId: string, assetId: string, quantity = 1) {
    if (!tableId || !assetId) return;
    try {
      await apiClient.post(`/api/tables/${tableId}/library/assets`, {
        assetId,
        quantity,
      });
      await get().fetchTableAssets(tableId);
    } catch (error) {
      console.error('Failed to add asset to table', error);
      set({ error: 'Unable to add asset to table' });
    }
  },

  async removeAssetFromTable(tableId: string, assetId: string) {
    if (!tableId || !assetId) return;
    try {
      await apiClient.delete(`/api/tables/${tableId}/library/assets/${assetId}`);
      await get().fetchTableAssets(tableId);
    } catch (error) {
      console.error('Failed to remove asset from table', error);
      set({ error: 'Unable to remove asset from table' });
    }
  },

  async trackAssetUsage(tableId: string, assetId: string) {
    if (!tableId || !assetId) return;
    try {
      await apiClient.post(`/api/library/assets/${assetId}/usage`, { tableId });
    } catch (error) {
      console.error('Failed to track asset usage', error);
    }
  },

  async ensureAssetForModel(modelId: string) {
    if (!modelId) return null;
    try {
      const response = await apiClient.get<{ asset: LibraryAsset }>(`/api/library/models/${modelId}/asset`);
      const raw = response.data?.asset;
      if (!raw) return null;
      const { ownedAssetIds, ownedModelIds } = get();
      const asset = normaliseLibraryAsset(raw, ownedAssetIds, ownedModelIds, modelId);
      set((state) => {
        const existingIndex = state.assets.findIndex((item) => item.id === asset.id);
        if (existingIndex >= 0) {
          const next = [...state.assets];
          next[existingIndex] = asset;
          return { assets: next };
        }
        return { assets: [...state.assets, asset] };
      });
      return asset;
    } catch (error) {
      console.error('Failed to ensure asset for model', error);
      return null;
    }
  },

  async fetchAssetSets() {
    try {
      const response = await apiClient.get<{ sets: AssetSet[] }>(`/api/library/sets`);
      const { ownedAssetIds, ownedModelIds } = get();
      const sets = (response.data?.sets ?? []).map((set) => ({
        ...set,
        assets: Array.isArray(set.assets)
          ? set.assets.map((asset) =>
              normaliseLibraryAsset(asset ?? {}, ownedAssetIds, ownedModelIds, asset?.model_id ?? asset?.modelId),
            )
          : [],
      }));
      set({ sets });
    } catch (error) {
      console.error('Failed to fetch asset sets', error);
      set({ error: 'Failed to load asset sets' });
    }
  },

  async fetchOwnedAssets() {
    try {
      const response = await apiClient.get<{ assets: LibraryAsset[] }>(`/api/library/owned`);
      const assets = (response.data?.assets ?? []).map((asset) => ({
        ...normaliseLibraryAsset(asset, new Set(), new Set(), asset.model_id ?? asset.modelId),
        owned: true,
      }));
      const ownedIds = new Set(
        assets
          .map((asset) => asset.id)
          .filter((id): id is string => Boolean(id)),
      );
      const ownedModelIds = new Set(
        assets
          .map((asset) => asset.modelId)
          .filter((id): id is string => Boolean(id)),
      );
      set((state) => {
        const mergedAssets = state.assets.map((asset) =>
          asset.id && ownedIds.has(asset.id)
            ? { ...asset, owned: true }
            : asset.modelId && ownedModelIds.has(asset.modelId)
            ? { ...asset, owned: true }
            : asset,
        );
        const mergedSets = state.sets.map((set) => ({
          ...set,
          assets: set.assets.map((asset) =>
            asset.id && ownedIds.has(asset.id)
              ? { ...asset, owned: true }
              : asset.modelId && ownedModelIds.has(asset.modelId)
              ? { ...asset, owned: true }
              : asset,
          ),
        }));
        return {
          ownedAssets: assets,
          assets: mergedAssets,
          sets: mergedSets,
          ownedAssetIds: new Set([...Array.from(state.ownedAssetIds), ...ownedIds]),
          ownedModelIds: new Set([...Array.from(state.ownedModelIds), ...ownedModelIds]),
        };
      });
    } catch (error: any) {
      if (error?.response?.status === 401) {
        set({ ownedAssets: [], ownedAssetIds: new Set(), ownedModelIds: new Set() });
        return;
      }
      console.error('Failed to load owned assets', error);
      set({ error: 'Failed to load owned assets' });
    }
  },

  async removeAssetFromLibrary(assetId: string) {
    if (!assetId) return;
    const applyRemoval = () => {
      set((state) => {
        const filteredAssets = state.assets.filter((asset) => asset.id !== assetId);
        const filteredOwned = state.ownedAssets.filter((asset) => asset.id !== assetId);
        const updatedOwnedIds = new Set(state.ownedAssetIds);
        updatedOwnedIds.delete(assetId);
        const updatedTableAssets = Object.fromEntries(
          Object.entries(state.tableAssets).map(([id, assets]) => [
            id,
            assets.filter((asset) => asset.asset_id !== assetId),
          ]),
        );

        return {
          assets: filteredAssets,
          ownedAssets: filteredOwned,
          ownedAssetIds: updatedOwnedIds,
          tableAssets: updatedTableAssets,
        };
      });
    };

    try {
      await apiClient.delete(`/api/library/owned/${assetId}`);
      applyRemoval();
    } catch (error: any) {
      const status = error?.response?.status;
      if (status === 401 || status === 404) {
        applyRemoval();
        return;
      }
      console.error('Failed to remove asset from library', error);
      throw error;
    }
  },
}));

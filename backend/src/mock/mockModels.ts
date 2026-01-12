import crypto from 'crypto';

export type MockModelStatus = 'draft' | 'published' | 'archived' | 'flagged';
export type MockModelVisibility = 'private' | 'public' | 'unlisted';

export interface MockModel {
  id: string;
  name: string;
  description: string | null;
  category: string;
  tags: string[];
  stlFilePath: string | null;
  glbFilePath: string | null;
  thumbnailPath: string | null;
  license: string;
  price: number;
  createdAt: string;
  status: MockModelStatus;
  visibility: MockModelVisibility;
  inLibrary: boolean;
}

const mockModelsByUser = new Map<string, MockModel[]>();

export function createMockModelId(): string {
  return crypto.randomUUID();
}

export function addMockModel(userId: string, model: MockModel): void {
  const existing = mockModelsByUser.get(userId) ?? [];
  mockModelsByUser.set(userId, [model, ...existing]);
}

export function listMockModels(userId?: string): MockModel[] {
  if (userId) {
    return [...(mockModelsByUser.get(userId) ?? [])];
  }
  return [...mockModelsByUser.values()].flat();
}

export function findMockModel(modelId: string): { ownerId: string; model: MockModel } | null {
  for (const [ownerId, models] of mockModelsByUser.entries()) {
    const match = models.find((model) => model.id === modelId);
    if (match) {
      return { ownerId, model: { ...match } };
    }
  }
  return null;
}

export function updateMockModel(modelId: string, updater: (model: MockModel) => void): boolean {
  for (const [ownerId, models] of mockModelsByUser.entries()) {
    const index = models.findIndex((model) => model.id === modelId);
    if (index !== -1) {
      const updated = { ...models[index] };
      updater(updated);
      const nextModels = [...models];
      nextModels[index] = updated;
      mockModelsByUser.set(ownerId, nextModels);
      return true;
    }
  }
  return false;
}

// Initialize mock data with sample models
export function initializeMockData(): void {
  const demoArtistId = 'demo-artist-001';
  const categories = ['buildings', 'nature', 'scatter', 'props', 'complete_sets'];
  const modelNames = [
    'Medieval Tower',
    'Ancient Ruins',
    'Forest Trees Pack',
    'Stone Bridge',
    'Tavern Building',
    'Mountain Terrain',
    'Village Houses',
    'Castle Walls',
  ];

  const models: MockModel[] = modelNames.map((name, index) => ({
    id: `mock-model-${index + 1}`,
    name,
    description: `High-quality ${name.toLowerCase()} perfect for tabletop gaming. Optimized for FDM printing with minimal supports.`,
    category: categories[index % categories.length],
    tags: ['terrain', 'tabletop', 'miniature', categories[index % categories.length]],
    stlFilePath: `models/demo/sample-${index}.stl`,
    glbFilePath: `models/demo/sample-${index}.glb`,
    thumbnailPath: `models/demo/sample-${index}-thumb.jpg`,
    license: 'standard',
    price: 15.99 + index * 5,
    createdAt: new Date(Date.now() - (modelNames.length - index) * 86400000).toISOString(),
    status: 'published',
    visibility: 'public',
    inLibrary: false,
  }));

  mockModelsByUser.set(demoArtistId, models);
}

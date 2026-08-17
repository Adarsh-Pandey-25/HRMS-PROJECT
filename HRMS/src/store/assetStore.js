import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { assets as assetSeed, assetRequests as requestSeed } from '../data';

export const useAssetStore = create(
  persist(
    (set) => ({
      assets: assetSeed,
      requests: requestSeed,
      actRequest: (id, status) => set((s) => ({ requests: s.requests.map((r) => (r.id === id ? { ...r, status } : r)) })),
      addAsset: (asset) => set((s) => ({ assets: [...s.assets, { id: `AST-${String(s.assets.length + 1).padStart(3, '0')}`, status: 'available', assignedTo: null, ...asset }] })),
    }),
    { name: 'zenith-assets' }
  )
);

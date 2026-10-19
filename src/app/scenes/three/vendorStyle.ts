// Vendor chassis finishes, shared by the detailed front panel and the baked low-detail server faces.
import type { VendorId } from '../../../engine/vendors';

/** Per-vendor finish: chassis/ear plastics, drive carriers, the hot-swap release colour. */
export const VSTYLE: Record<VendorId, { ear: string; plate: string; grille: string; carrier: string; handle: string; release: string; text: string }> = {
  dell: { ear: '#17191d', plate: '#1d2025', grille: '#2a2e34', carrier: '#25282d', handle: '#15171a', release: '#c8562f', text: '#c9ced4' },
  hpe: { ear: '#2a2e33', plate: '#33383e', grille: '#454b52', carrier: '#5b6168', handle: '#2a2e33', release: '#c8562f', text: '#e1e5e9' },
  lenovo: { ear: '#141517', plate: '#1a1b1e', grille: '#26282c', carrier: '#1f2124', handle: '#101113', release: '#d9692b', text: '#d5d8dc' },
  supermicro: { ear: '#2b2e33', plate: '#2f3338', grille: '#3d4248', carrier: '#25282c', handle: '#b8bec5', release: '#2f7de1', text: '#d0d5da' },
};

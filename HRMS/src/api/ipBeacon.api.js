import { apiRequest } from './client';

export const listBeaconsApi = () => apiRequest({ method: 'GET', url: '/attendance/beacons' });

export const createBeaconApi = (label, expectedRegion) =>
  apiRequest({ method: 'POST', url: '/attendance/beacons', data: { label, expected_region: expectedRegion } });

export const revokeBeaconApi = (id) => apiRequest({ method: 'POST', url: `/attendance/beacons/${id}/revoke` });

export const listPendingBeaconApprovalsApi = () => apiRequest({ method: 'GET', url: '/attendance/beacons/pending-approvals' });

export const resolveBeaconApprovalApi = (id, decision) =>
  apiRequest({ method: 'POST', url: `/attendance/beacons/pending-approvals/${id}/resolve`, data: { decision } });

import { apiRequest } from './client';

export const listIpWhitelistApi = () => apiRequest({ method: 'GET', url: '/ip-whitelist' });
export const createIpWhitelistEntryApi = (cidr, label) => apiRequest({ method: 'POST', url: '/ip-whitelist', data: { cidr, label } });
export const removeIpWhitelistEntryApi = (id) => apiRequest({ method: 'DELETE', url: `/ip-whitelist/${id}` });

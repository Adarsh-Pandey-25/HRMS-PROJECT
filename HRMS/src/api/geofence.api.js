import { apiRequest } from './client';

export const listGeofencesApi = () => apiRequest({ method: 'GET', url: '/geofences' });

export const createGeofenceApi = (payload) => apiRequest({ method: 'POST', url: '/geofences', data: payload });

export const updateGeofenceApi = (id, payload) => apiRequest({ method: 'PUT', url: `/geofences/${id}`, data: payload });

export const deactivateGeofenceApi = (id) => apiRequest({ method: 'POST', url: `/geofences/${id}/deactivate` });

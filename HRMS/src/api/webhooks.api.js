import { apiRequest, apiRequestPaginated } from './client';

export const fetchWebhookCatalogApi = () => apiRequest({ method: 'GET', url: '/webhooks/catalog' });
export const listWebhooksApi = () => apiRequest({ method: 'GET', url: '/webhooks' });
export const createWebhookApi = (url, subscribedEvents) =>
  apiRequest({ method: 'POST', url: '/webhooks', data: { url, subscribed_events: subscribedEvents } });
export const updateWebhookApi = (id, patch) =>
  apiRequest({
    method: 'PUT',
    url: `/webhooks/${id}`,
    data: {
      ...(patch.url !== undefined ? { url: patch.url } : {}),
      ...(patch.subscribedEvents !== undefined ? { subscribed_events: patch.subscribedEvents } : {}),
      ...(patch.isActive !== undefined ? { is_active: patch.isActive } : {}),
    },
  });
export const deleteWebhookApi = (id) => apiRequest({ method: 'DELETE', url: `/webhooks/${id}` });
export const listWebhookDeliveriesApi = (id, params) => apiRequestPaginated({ method: 'GET', url: `/webhooks/${id}/deliveries`, params });
export const sendTestWebhookEventApi = (id) => apiRequest({ method: 'POST', url: `/webhooks/${id}/test` });

import { apiRequest } from './client';
import { mapHolidayFromApi } from '../lib/mappers';

export async function fetchHolidaysByYearApi(year) {
  const rows = await apiRequest({ method: 'GET', url: `/holidays/year/${year}` });
  return (Array.isArray(rows) ? rows : []).map(mapHolidayFromApi);
}

export async function fetchUpcomingHolidaysApi() {
  const rows = await apiRequest({ method: 'GET', url: '/holidays/upcoming' });
  return (Array.isArray(rows) ? rows : []).map(mapHolidayFromApi);
}

export async function createHolidayApi({ name, date, type }) {
  const data = await apiRequest({
    method: 'POST',
    url: '/holidays/create',
    data: {
      title: name,
      date,
      type: type === 'national' ? 'public' : type,
      is_mandatory: type !== 'optional',
    },
  });
  return mapHolidayFromApi(data);
}

export async function deleteHolidayApi(id) {
  return apiRequest({ method: 'DELETE', url: `/holidays/${id}` });
}

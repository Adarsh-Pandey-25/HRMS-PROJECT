import { apiRequest } from './client';

export async function fetchDeviceMappingsApi() {
  return apiRequest({ method: 'GET', url: '/device-mapping' });
}

export async function createDeviceMappingApi({ deviceUserId, employeeId, deviceSerial }) {
  return apiRequest({
    method: 'POST',
    url: '/device-mapping',
    data: { device_user_id: deviceUserId, employee_id: employeeId, device_serial: deviceSerial },
  });
}

export async function deleteDeviceMappingApi(deviceUserId, deviceSerial) {
  return apiRequest({
    method: 'DELETE',
    url: `/device-mapping/${deviceUserId}`,
    params: deviceSerial ? { device_serial: deviceSerial } : {},
  });
}

export async function fetchUnmappedPunchesApi() {
  return apiRequest({ method: 'GET', url: '/device-mapping/unmapped' });
}

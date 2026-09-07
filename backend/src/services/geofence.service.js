const { supabaseAdmin } = require('../config/supabase');
const { BadRequestError, NotFoundError, ForbiddenError } = require('../utils/errors');

/** Great-circle distance in meters — standard Haversine formula. */
const EARTH_RADIUS_M = 6371000;
const toRad = (deg) => (deg * Math.PI) / 180;
const haversineMeters = (lat1, lon1, lat2, lon2) => {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const MIN_RADIUS_M = 20;
const MAX_RADIUS_M = 2000;

const listGeofences = async (companyId, { includeInactive = false } = {}) => {
  let query = supabaseAdmin.from('geofences').select('*').eq('company_id', companyId).order('created_at', { ascending: false });
  if (!includeInactive) query = query.eq('is_active', true);
  const { data, error } = await query;
  if (error) throw new BadRequestError(error.message);
  return data || [];
};

const createGeofence = async (companyId, { label, centerLatitude, centerLongitude, radiusMeters }, createdBy) => {
  if (!label || !String(label).trim()) throw new BadRequestError('Label is required');
  const lat = Number(centerLatitude);
  const lon = Number(centerLongitude);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) throw new BadRequestError('Invalid latitude');
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) throw new BadRequestError('Invalid longitude');
  const radius = radiusMeters == null ? 150 : Number(radiusMeters);
  if (!Number.isFinite(radius) || radius < MIN_RADIUS_M || radius > MAX_RADIUS_M) {
    throw new BadRequestError(`radius_meters must be between ${MIN_RADIUS_M} and ${MAX_RADIUS_M}`);
  }

  const { data, error } = await supabaseAdmin
    .from('geofences')
    .insert({ company_id: companyId, label: String(label).trim(), center_latitude: lat, center_longitude: lon, radius_meters: radius, created_by: createdBy })
    .select('*')
    .single();
  if (error) throw new BadRequestError(error.message);
  return data;
};

const updateGeofence = async (companyId, geofenceId, patch) => {
  const updates = { updated_at: new Date().toISOString() };
  if (patch.label !== undefined) updates.label = String(patch.label).trim();
  if (patch.centerLatitude !== undefined) {
    const lat = Number(patch.centerLatitude);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) throw new BadRequestError('Invalid latitude');
    updates.center_latitude = lat;
  }
  if (patch.centerLongitude !== undefined) {
    const lon = Number(patch.centerLongitude);
    if (!Number.isFinite(lon) || lon < -180 || lon > 180) throw new BadRequestError('Invalid longitude');
    updates.center_longitude = lon;
  }
  if (patch.radiusMeters !== undefined) {
    const radius = Number(patch.radiusMeters);
    if (!Number.isFinite(radius) || radius < MIN_RADIUS_M || radius > MAX_RADIUS_M) {
      throw new BadRequestError(`radius_meters must be between ${MIN_RADIUS_M} and ${MAX_RADIUS_M}`);
    }
    updates.radius_meters = radius;
  }
  if (patch.isActive !== undefined) updates.is_active = Boolean(patch.isActive);

  const { data, error } = await supabaseAdmin
    .from('geofences')
    .update(updates)
    .eq('id', geofenceId)
    .eq('company_id', companyId)
    .select('*')
    .maybeSingle();
  if (error) throw new BadRequestError(error.message);
  if (!data) throw new NotFoundError('Geofence not found');
  return data;
};

const deactivateGeofence = async (companyId, geofenceId) => updateGeofence(companyId, geofenceId, { isActive: false });

/**
 * Section E: boolean check — within radius of AT LEAST ONE active geofence
 * (multi-branch). No fences configured = not blocking (returns true).
 * Split from assertWithinGeofence so Section E's "either check sufficient"
 * OR-logic can evaluate both IP and GPS without one throwing before the
 * other is tried.
 */
const isWithinAnyGeofence = async (companyId, latitude, longitude) => {
  const lat = Number(latitude);
  const lon = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return { ok: false, reason: 'no_location' };

  const fences = await listGeofences(companyId);
  if (!fences.length) return { ok: true, reason: 'no_fences_configured' };

  const withinAny = fences.some((f) => haversineMeters(lat, lon, f.center_latitude, f.center_longitude) <= f.radius_meters);
  return { ok: withinAny, reason: withinAny ? 'within_range' : 'outside_range' };
};

const assertWithinGeofence = async (companyId, latitude, longitude) => {
  const { ok, reason } = await isWithinAnyGeofence(companyId, latitude, longitude);
  if (ok) return;
  if (reason === 'no_location') {
    throw new BadRequestError('Location is required for check-in at this company. Please allow location access and try again.');
  }
  throw new ForbiddenError("You're outside your office location. Check-in requires you to be at one of your company's approved locations.");
};

module.exports = {
  haversineMeters, listGeofences, createGeofence, updateGeofence, deactivateGeofence,
  isWithinAnyGeofence, assertWithinGeofence,
  MIN_RADIUS_M, MAX_RADIUS_M,
};

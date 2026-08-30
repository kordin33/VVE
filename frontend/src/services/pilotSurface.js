// Frontend adapter for the shared PilotAvailability manifest (VVE-100, Module 9).
//
// The environment is fixed at build time: a production build IS the Pilot
// surface, a development build is the development surface. The internal
// `__dev` flag can therefore only ever widen a development build — an
// untrusted query parameter can never activate excluded features in pilot.
import { createPilotAvailability } from '@pilot/availability';

export const PILOT_ENVIRONMENT = import.meta.env.PROD ? 'pilot' : 'development';

export const pilotAvailability = createPilotAvailability();

export const isDevSurface = () => {
  if (PILOT_ENVIRONMENT !== 'development') return false;
  try {
    const url = new URL(window.location.href);
    return url.searchParams.get('__dev') === '1' || localStorage.getItem('vve_dev_surface') === '1';
  } catch {
    return false;
  }
};

/** Manifest decision for one feature under the current environment and a role. */
export const featureAvailable = (featureId, role, devSurface = isDevSurface()) =>
  pilotAvailability.require(featureId, {
    environment: PILOT_ENVIRONMENT,
    role,
    devSurface
  }).available;

/** Role-resolved manifest (visible tools, surfaces) for enumeration. */
export const resolveManifest = (role) =>
  pilotAvailability.resolve({ environment: PILOT_ENVIRONMENT, role });

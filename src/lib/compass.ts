/**
 * Compass heading for photo identification.
 *
 * iPhone only allows one permission-type request per tap, so the compass
 * permission is asked when the photo screen is opened, never on the same tap
 * that opens the camera (that would stop the camera from opening).
 */
let heading: number | null = null;
let listening = false;

function listen() {
  if (listening) return;
  listening = true;
  const onOrient = (e: DeviceOrientationEvent) => {
    const ios = (e as DeviceOrientationEvent & { webkitCompassHeading?: number }).webkitCompassHeading;
    if (typeof ios === 'number') heading = ios;
    else if (e.absolute && typeof e.alpha === 'number') heading = (360 - e.alpha) % 360;
  };
  window.addEventListener('deviceorientationabsolute', onOrient as EventListener);
  window.addEventListener('deviceorientation', onOrient);
}

/** Call from a tap handler (not the one that opens the camera). */
export function startCompass(): void {
  if (listening || typeof window === 'undefined') return;
  const DOE = window.DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> } | undefined;
  if (DOE?.requestPermission) {
    DOE.requestPermission()
      .then((r) => r === 'granted' && listen())
      .catch(() => undefined); // declined: photo answers lean on GPS only
  } else if (DOE) {
    listen();
  }
}

export const currentHeading = () => heading;

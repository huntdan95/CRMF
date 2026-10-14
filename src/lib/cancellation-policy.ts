/**
 * The cancellation policy shown on /cancellation-policy until Travis saves
 * his own in Admin → Settings. One copy for both, so the admin form starts
 * from exactly what customers see and a first save doesn't quietly change it.
 */
export const DEFAULT_CANCELLATION_POLICY = [
  'More than 72 hours before your tour: full refund.',
  '24-72 hours before your tour: 50% refund.',
  'Less than 24 hours before your tour: no refund (call Travis for emergencies — he works with people who get sick or have family situations).',
  'Travis-cancelled tours (weather, mechanical, etc.): always full refund. Always.',
  'Changing dates: move your tour at no charge, as long as the new departure has space.',
  'No manatees: if we go out and don’t see one, we’ll re-book you on another tour for free.',
].join('\n');

/**
 * Public self-registration switch.
 *
 * - Variable unset: registration stays open (development and CI behave as before).
 * - Any value other than the exact string "true" closes it, so a typo such as
 *   "False" or "no" fails closed. The production compose file defaults to "false".
 * Accounts are then created on the server with `npm run user:create`.
 */
export function isPublicRegistrationEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.ALLOW_PUBLIC_REGISTRATION === undefined) return true;
  return env.ALLOW_PUBLIC_REGISTRATION === 'true';
}

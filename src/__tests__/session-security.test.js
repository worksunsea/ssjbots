import { describe, it, expect, beforeEach } from 'vitest';
import {
  REAUTH_DAYS_DEFAULT,
  DEVICE_TRUST_DAYS_DEFAULT,
  getDeviceToken,
  isSessionExpired,
  shouldForceLogout,
  isTrustedUntilValid,
} from '../utils/session-security.js';

const DAY_MS = 86400000;
const NOW = 1783000000000; // fixed reference instant

// ─── isSessionExpired ────────────────────────────────────────────────────────

describe('isSessionExpired', () => {
  it('superadmin is always exempt, even with no authAt', () => {
    expect(isSessionExpired({ role: 'superadmin' }, NOW)).toBe(false);
  });

  it('superadmin is exempt even with a very old authAt', () => {
    expect(isSessionExpired({ role: 'superadmin', authAt: NOW - 999 * DAY_MS }, NOW)).toBe(false);
  });

  it('non-superadmin with missing authAt is treated as expired', () => {
    expect(isSessionExpired({ role: 'manager' }, NOW)).toBe(true);
    expect(isSessionExpired({ role: 'manager', authAt: null }, NOW)).toBe(true);
  });

  it('expired at 16 days for a non-superadmin', () => {
    const authAt = NOW - 16 * DAY_MS;
    expect(isSessionExpired({ role: 'manager', authAt }, NOW)).toBe(true);
  });

  it('not expired at 14 days for a non-superadmin', () => {
    const authAt = NOW - 14 * DAY_MS;
    expect(isSessionExpired({ role: 'manager', authAt }, NOW)).toBe(false);
  });

  it('respects a custom reauthDays window', () => {
    const authAt = NOW - 10 * DAY_MS;
    expect(isSessionExpired({ role: 'staff', authAt }, NOW, 7)).toBe(true);
    expect(isSessionExpired({ role: 'staff', authAt }, NOW, 30)).toBe(false);
  });

  it('applies to every non-superadmin role (staff, telecaller, admin, manager)', () => {
    const authAt = NOW - 16 * DAY_MS;
    for (const role of ['staff', 'telecaller', 'admin', 'manager']) {
      expect(isSessionExpired({ role, authAt }, NOW), role).toBe(true);
    }
  });

  it('defaults reauthDays to REAUTH_DAYS_DEFAULT (15)', () => {
    const justOver = NOW - (REAUTH_DAYS_DEFAULT * DAY_MS + 1);
    const justUnder = NOW - (REAUTH_DAYS_DEFAULT * DAY_MS - 1);
    expect(isSessionExpired({ role: 'staff', authAt: justOver }, NOW)).toBe(true);
    expect(isSessionExpired({ role: 'staff', authAt: justUnder }, NOW)).toBe(false);
  });
});

// ─── shouldForceLogout ───────────────────────────────────────────────────────

describe('shouldForceLogout', () => {
  it('forces logout when deactivated, regardless of a fresh session', () => {
    const user = { role: 'staff', authAt: NOW };
    expect(shouldForceLogout({ active: false, user, nowMs: NOW })).toBe(true);
  });

  it('forces logout when expired but still active', () => {
    const user = { role: 'staff', authAt: NOW - 16 * DAY_MS };
    expect(shouldForceLogout({ active: true, user, nowMs: NOW })).toBe(true);
  });

  it('does not force logout for an active, non-expired non-superadmin', () => {
    const user = { role: 'staff', authAt: NOW - 1 * DAY_MS };
    expect(shouldForceLogout({ active: true, user, nowMs: NOW })).toBe(false);
  });

  it('deactivated superadmin is still forced out (deactivation overrides the reauth exemption)', () => {
    const user = { role: 'superadmin', authAt: NOW };
    expect(shouldForceLogout({ active: false, user, nowMs: NOW })).toBe(true);
  });

  it('active superadmin with no authAt is never forced out', () => {
    const user = { role: 'superadmin' };
    expect(shouldForceLogout({ active: true, user, nowMs: NOW })).toBe(false);
  });
});

// ─── isTrustedUntilValid ─────────────────────────────────────────────────────

describe('isTrustedUntilValid', () => {
  it('trusted_until in the future is valid', () => {
    const future = new Date(NOW + DAY_MS).toISOString();
    expect(isTrustedUntilValid(future, NOW)).toBe(true);
  });

  it('trusted_until in the past is not valid', () => {
    const past = new Date(NOW - DAY_MS).toISOString();
    expect(isTrustedUntilValid(past, NOW)).toBe(false);
  });

  it('missing trusted_until is not valid', () => {
    expect(isTrustedUntilValid(null, NOW)).toBe(false);
    expect(isTrustedUntilValid(undefined, NOW)).toBe(false);
  });

  it('DEVICE_TRUST_DAYS_DEFAULT window (30 days) is respected end-to-end', () => {
    const trustedUntil = new Date(NOW + DEVICE_TRUST_DAYS_DEFAULT * DAY_MS).toISOString();
    expect(isTrustedUntilValid(trustedUntil, NOW)).toBe(true);
    expect(isTrustedUntilValid(trustedUntil, NOW + (DEVICE_TRUST_DAYS_DEFAULT + 1) * DAY_MS)).toBe(false);
  });
});

// ─── getDeviceToken ──────────────────────────────────────────────────────────

describe('getDeviceToken', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('generates a token on first call and persists it', () => {
    const token = getDeviceToken();
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(0);
    expect(localStorage.getItem('ssj_device_token')).toBe(token);
  });

  it('returns the same token on subsequent calls (same device)', () => {
    const first = getDeviceToken();
    const second = getDeviceToken();
    expect(second).toBe(first);
  });

  it('a cleared localStorage produces a different token (new device)', () => {
    const first = getDeviceToken();
    localStorage.clear();
    const second = getDeviceToken();
    expect(second).not.toBe(first);
  });
});

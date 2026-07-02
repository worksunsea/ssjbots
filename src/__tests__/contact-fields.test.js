import { describe, it, expect } from 'vitest';
import {
  FIXED_CONTACT_FIELDS,
  FIXED_DB_KEYS,
  SPECIAL_RENDER_KEYS,
  getAllFieldsOrdered,
  normalizePhone,
  parseDateJS,
  buildContactPayload,
  buildContactFormState,
} from '../utils/contact-fields.js';

// ─── INTEGRITY: FIXED_CONTACT_FIELDS shape ───────────────────────────────────

describe('FIXED_CONTACT_FIELDS integrity', () => {
  it('every field has key, label, and fixed:true', () => {
    for (const f of FIXED_CONTACT_FIELDS) {
      expect(typeof f.key,   `${f.key} missing key`).toBe('string');
      expect(typeof f.label, `${f.key} missing label`).toBe('string');
      expect(f.fixed, `${f.key} must have fixed:true`).toBe(true);
    }
  });

  it('no duplicate keys', () => {
    const keys = FIXED_CONTACT_FIELDS.map(f => f.key);
    const unique = new Set(keys);
    expect(unique.size).toBe(keys.length);
  });

  it('exactly one field marked required (phone)', () => {
    const required = FIXED_CONTACT_FIELDS.filter(f => f.required);
    expect(required).toHaveLength(1);
    expect(required[0].key).toBe('phone');
  });
});

// ─── INTEGRITY: buildContactFormState covers all fixed keys ──────────────────

describe('buildContactFormState integrity', () => {
  const state = buildContactFormState({});

  it('form state contains a key for every fixed field', () => {
    for (const f of FIXED_CONTACT_FIELDS) {
      if (SPECIAL_RENDER_KEYS.has(f.key)) continue; // client_rating, source handled normally too
      expect(Object.prototype.hasOwnProperty.call(state, f.key),
        `form state missing key: ${f.key}`).toBe(true);
    }
  });

  it('form state also contains non-field keys (tags, partner_lead_id, extra_fields)', () => {
    expect(state).toHaveProperty('tags');
    expect(state).toHaveProperty('partner_lead_id');
    expect(state).toHaveProperty('extra_fields');
  });

  it('defaults phone to empty string', () => {
    expect(state.phone).toBe('');
  });

  it('defaults is_client to false', () => {
    expect(state.is_client).toBe(false);
  });

  it('defaults address_country to "India"', () => {
    expect(state.address_country).toBe('India');
  });

  it('reads existing contact values', () => {
    const s = buildContactFormState({ name: 'Ravi', city: 'Mumbai', client_rating: 3 });
    expect(s.name).toBe('Ravi');
    expect(s.city).toBe('Mumbai');
    expect(s.client_rating).toBe(3);
  });
});

// ─── INTEGRITY: buildContactPayload covers all fixed keys ────────────────────

describe('buildContactPayload integrity', () => {
  const form = buildContactFormState({ phone: '9876543210', name: 'Test' });
  const payload = buildContactPayload('tenant-1', form);

  it('payload contains every fixed DB key except is_client (handled separately)', () => {
    for (const key of FIXED_DB_KEYS) {
      if (key === 'is_client') continue;
      expect(Object.prototype.hasOwnProperty.call(payload, key),
        `payload missing key: ${key}`).toBe(true);
    }
  });

  it('payload contains tenant_id, tags, partner_lead_id, extra_fields', () => {
    expect(payload.tenant_id).toBe('tenant-1');
    expect(payload).toHaveProperty('tags');
    expect(payload).toHaveProperty('partner_lead_id');
    expect(payload).toHaveProperty('extra_fields');
  });

  it('normalises phone in payload', () => {
    const p = buildContactPayload('t', buildContactFormState({ phone: '0 9876-543210' }));
    expect(p.phone).toBe('9876543210');
  });

  it('converts client_rating to Number', () => {
    const p = buildContactPayload('t', buildContactFormState({ phone: '1', client_rating: '4' }));
    expect(p.client_rating).toBe(4);
    expect(typeof p.client_rating).toBe('number');
  });

  it('nulls out empty strings', () => {
    const p = buildContactPayload('t', buildContactFormState({ phone: '1' }));
    expect(p.name).toBeNull();
    expect(p.city).toBeNull();
  });
});

// ─── UNIT: normalizePhone ─────────────────────────────────────────────────────

describe('normalizePhone', () => {
  it('strips non-digit characters', () => {
    expect(normalizePhone('+91 98765-43210')).toBe('9876543210');
  });

  it('strips leading 91 country code', () => {
    expect(normalizePhone('919876543210')).toBe('9876543210');
  });

  it('strips leading zero', () => {
    expect(normalizePhone('09876543210')).toBe('9876543210');
  });

  it('strips WA LID device suffix (colon notation)', () => {
    expect(normalizePhone('918860866000:19')).toBe('8860866000');
  });

  it('handles null/undefined gracefully', () => {
    expect(normalizePhone(null)).toBe('');
    expect(normalizePhone(undefined)).toBe('');
  });

  it('leaves clean number unchanged', () => {
    expect(normalizePhone('9876543210')).toBe('9876543210');
  });
});

// ─── UNIT: parseDateJS ────────────────────────────────────────────────────────

describe('parseDateJS', () => {
  it('parses DD/MM/YYYY', () => {
    expect(parseDateJS('15/03/1985')).toBe('1985-03-15');
  });

  it('parses DD-MM-YYYY', () => {
    expect(parseDateJS('15-03-1985')).toBe('1985-03-15');
  });

  it('parses YYYY-MM-DD passthrough', () => {
    expect(parseDateJS('1985-03-15')).toBe('1985-03-15');
  });

  it('parses 2-digit year > 30 as 19xx', () => {
    expect(parseDateJS('01/01/85')).toBe('1985-01-01');
  });

  it('parses 2-digit year <= 30 as 20xx', () => {
    expect(parseDateJS('01/01/25')).toBe('2025-01-01');
  });

  it('returns null for empty / null input', () => {
    expect(parseDateJS(null)).toBeNull();
    expect(parseDateJS('')).toBeNull();
    expect(parseDateJS(undefined)).toBeNull();
  });

  it('returns null for garbage input', () => {
    expect(parseDateJS('not-a-date')).toBeNull();
  });

  it('handles Date object', () => {
    expect(parseDateJS(new Date('1985-03-15'))).toBe('1985-03-15');
  });
});

// ─── UNIT: getAllFieldsOrdered ────────────────────────────────────────────────

describe('getAllFieldsOrdered', () => {
  const customFields = [{ key: 'gst_no', label: 'GST No' }];

  it('returns fixed + custom with no order saved', () => {
    const result = getAllFieldsOrdered(customFields, null);
    const keys = result.map(f => f.key);
    expect(keys).toContain('name');
    expect(keys).toContain('phone');
    expect(keys).toContain('gst_no');
    expect(keys.indexOf('name')).toBeLessThan(keys.indexOf('gst_no'));
  });

  it('respects saved field order', () => {
    const order = ['gst_no', 'name', 'phone'];
    const result = getAllFieldsOrdered(customFields, order);
    const keys = result.map(f => f.key);
    expect(keys[0]).toBe('gst_no');
    expect(keys[1]).toBe('name');
    expect(keys[2]).toBe('phone');
  });

  it('appends fields not in saved order at the end', () => {
    const order = ['name', 'phone'];
    const result = getAllFieldsOrdered(customFields, order);
    const keys = result.map(f => f.key);
    expect(keys).toContain('gst_no');
    expect(keys.indexOf('gst_no')).toBeGreaterThan(keys.indexOf('phone'));
  });

  it('produces no duplicate keys', () => {
    const result = getAllFieldsOrdered(customFields, null);
    const keys = result.map(f => f.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('marks fixed fields as fixed:true and custom as fixed:false', () => {
    const result = getAllFieldsOrdered(customFields, null);
    const nameField = result.find(f => f.key === 'name');
    const gstField = result.find(f => f.key === 'gst_no');
    expect(nameField.fixed).toBe(true);
    expect(gstField.fixed).toBe(false);
  });

  it('handles empty custom fields', () => {
    const result = getAllFieldsOrdered([], null);
    expect(result.length).toBe(FIXED_CONTACT_FIELDS.length);
  });
});

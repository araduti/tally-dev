/**
 * Unit tests for src/lib/sensitive-keys.ts
 *
 * Covers:
 *  - SENSITIVE_KEYS contains the expected set of keys
 *  - sanitize() redacts top-level sensitive keys
 *  - sanitize() recurses into nested objects
 *  - sanitize() handles Error objects (message, name, stack)
 *  - sanitize() omits stack in production
 *  - sanitize() does not mutate the input object
 *  - sanitize() passes through arrays and primitives unchanged
 *  - sanitize() handles the newly added clientSecret / clientId keys
 */

import { describe, it, expect, afterEach } from 'vitest';
import { SENSITIVE_KEYS, sanitize } from '../sensitive-keys';

describe('sensitive-keys', () => {
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  describe('SENSITIVE_KEYS', () => {
    it('should contain all expected keys', () => {
      const expected = [
        'password',
        'credentials',
        'token',
        'secret',
        'accessToken',
        'refreshToken',
        'apiKey',
        'encryptionKey',
        'ENCRYPTION_KEY',
        'clientSecret',
        'clientId',
      ];
      for (const key of expected) {
        expect(SENSITIVE_KEYS.has(key)).toBe(true);
      }
      expect(SENSITIVE_KEYS.size).toBe(expected.length);
    });
  });

  describe('sanitize()', () => {
    it('should redact top-level sensitive keys', () => {
      const input = {
        password: 'hunter2',
        apiKey: 'ak_12345',
        accessToken: 'tok_abc',
        normalField: 'safe-value',
      };

      const result = sanitize(input);

      expect(result.password).toBe('[REDACTED]');
      expect(result.apiKey).toBe('[REDACTED]');
      expect(result.accessToken).toBe('[REDACTED]');
      expect(result.normalField).toBe('safe-value');
    });

    it('should redact clientSecret and clientId (vendor creds)', () => {
      const input = {
        clientSecret: 'cs_secret',
        clientId: 'ci_id',
        host: 'example.com',
      };

      const result = sanitize(input);

      expect(result.clientSecret).toBe('[REDACTED]');
      expect(result.clientId).toBe('[REDACTED]');
      expect(result.host).toBe('example.com');
    });

    it('should recursively sanitize nested objects', () => {
      const input = {
        connection: {
          apiKey: 'secret-key',
          host: 'example.com',
          nested: {
            refreshToken: 'rt_abc',
            port: 443,
          },
        },
      };

      const result = sanitize(input);

      const connection = result.connection as Record<string, unknown>;
      expect(connection.apiKey).toBe('[REDACTED]');
      expect(connection.host).toBe('example.com');

      const nested = connection.nested as Record<string, unknown>;
      expect(nested.refreshToken).toBe('[REDACTED]');
      expect(nested.port).toBe(443);
    });

    it('should extract Error properties in non-production', () => {
      process.env.NODE_ENV = 'development';
      const error = new Error('something broke');
      error.name = 'CustomError';

      const result = sanitize({ err: error });

      const errResult = result.err as Record<string, unknown>;
      expect(errResult.message).toBe('something broke');
      expect(errResult.name).toBe('CustomError');
      expect(errResult.stack).toBeDefined();
    });

    it('should omit Error stack in production', () => {
      process.env.NODE_ENV = 'production';
      const error = new Error('something broke');

      const result = sanitize({ err: error });

      const errResult = result.err as Record<string, unknown>;
      expect(errResult.message).toBe('something broke');
      expect(errResult.name).toBe('Error');
      expect(errResult.stack).toBeUndefined();
    });

    it('should never mutate the input object', () => {
      const input = {
        password: 'hunter2',
        data: { apiKey: 'ak_12345', host: 'example.com' },
      };
      const inputCopy = JSON.parse(JSON.stringify(input));

      sanitize(input);

      expect(input).toEqual(inputCopy);
    });

    it('should pass primitive arrays through unchanged', () => {
      const input = {
        items: [1, 2, 3],
        tags: ['a', 'b'],
      };

      const result = sanitize(input);

      expect(result.items).toEqual([1, 2, 3]);
      expect(result.tags).toEqual(['a', 'b']);
    });

    it('should recursively sanitize objects inside arrays', () => {
      const input = {
        connections: [
          { host: 'a.example.com', apiKey: 'ak_111' },
          { host: 'b.example.com', password: 'pw_222' },
        ],
      };

      const result = sanitize(input);

      const connections = result.connections as Array<Record<string, unknown>>;
      expect(connections[0].host).toBe('a.example.com');
      expect(connections[0].apiKey).toBe('[REDACTED]');
      expect(connections[1].host).toBe('b.example.com');
      expect(connections[1].password).toBe('[REDACTED]');
    });

    it('should pass primitives through unchanged', () => {
      const input = {
        count: 42,
        name: 'test',
        active: true,
        empty: null,
      };

      const result = sanitize(input);

      expect(result.count).toBe(42);
      expect(result.name).toBe('test');
      expect(result.active).toBe(true);
      expect(result.empty).toBeNull();
    });

    it('should handle empty objects', () => {
      expect(sanitize({})).toEqual({});
    });

    it('should handle deeply nested sensitive keys', () => {
      const input = {
        level1: {
          level2: {
            level3: {
              encryptionKey: 'ek_secret',
              value: 'safe',
            },
          },
        },
      };

      const result = sanitize(input);

      const l1 = result.level1 as Record<string, unknown>;
      const l2 = l1.level2 as Record<string, unknown>;
      const l3 = l2.level3 as Record<string, unknown>;
      expect(l3.encryptionKey).toBe('[REDACTED]');
      expect(l3.value).toBe('safe');
    });
  });
});

// ---------------------------------------------------------------------------
// Vendor adapter layer — unit tests
// ---------------------------------------------------------------------------
// Covers: VendorError, DIRECT adapter, adapter registry, and authentication
// guard for PAX8, INGRAM, and TDSYNNEX adapters.
// ---------------------------------------------------------------------------

import { VendorError } from '@/adapters/types';
import { directAdapter } from '@/adapters/direct';
import { pax8Adapter } from '@/adapters/pax8';
import { ingramAdapter } from '@/adapters/ingram';
import { tdSynnexAdapter } from '@/adapters/tdsynnex';
import { getAdapter, decryptCredentials } from '@/adapters/index';
import { decrypt } from '@/lib/encryption';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/lib/encryption', () => ({
  decrypt: vi.fn().mockReturnValue('{"clientId":"id","clientSecret":"secret"}'),
  encrypt: vi.fn().mockReturnValue('encrypted'),
}));

// Save and restore the original global fetch between tests so that mocks in
// one suite never leak into another.
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.clearAllMocks();
});

// ═══════════════════════════════════════════════════════════════════════════
// 1. VendorError
// ═══════════════════════════════════════════════════════════════════════════

describe('VendorError', () => {
  it('sets name to "VendorError"', () => {
    const err = new VendorError('PAX8', null);
    expect(err.name).toBe('VendorError');
  });

  it('is an instance of Error', () => {
    const err = new VendorError('INGRAM', null);
    expect(err).toBeInstanceOf(Error);
  });

  it('stores vendorType as a readonly property', () => {
    const err = new VendorError('TDSYNNEX', null);
    expect(err.vendorType).toBe('TDSYNNEX');
  });

  it('stores originalError as a readonly property', () => {
    const cause = new TypeError('network');
    const err = new VendorError('PAX8', cause);
    expect(err.originalError).toBe(cause);
  });

  it('uses the provided message', () => {
    const err = new VendorError('DIRECT', null, 'something broke');
    expect(err.message).toBe('something broke');
  });

  it('generates a default message when none is given', () => {
    const err = new VendorError('PAX8', null);
    expect(err.message).toBe('Vendor API error from PAX8');
  });

  it('generates a default message for every vendor type', () => {
    const types = ['PAX8', 'INGRAM', 'TDSYNNEX', 'DIRECT'] as const;
    for (const vt of types) {
      const err = new VendorError(vt, null);
      expect(err.message).toContain(vt);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. DIRECT adapter
// ═══════════════════════════════════════════════════════════════════════════

describe('directAdapter', () => {
  const creds = {};

  // -- vendorType --------------------------------------------------------
  it('has vendorType "DIRECT"', () => {
    expect(directAdapter.vendorType).toBe('DIRECT');
  });

  // -- getSubscriptions --------------------------------------------------
  describe('getSubscriptions', () => {
    it('returns an empty array', async () => {
      const result = await directAdapter.getSubscriptions(creds);
      expect(result).toEqual([]);
    });
  });

  // -- getProductCatalog -------------------------------------------------
  describe('getProductCatalog', () => {
    it('returns an empty array', async () => {
      const result = await directAdapter.getProductCatalog(creds);
      expect(result).toEqual([]);
    });
  });

  // -- setQuantity -------------------------------------------------------
  describe('setQuantity', () => {
    it('resolves without error for valid quantity', async () => {
      await expect(
        directAdapter.setQuantity(creds, 'sub-123', 10),
      ).resolves.toBeUndefined();
    });

    it('accepts quantity of 0', async () => {
      await expect(
        directAdapter.setQuantity(creds, 'sub-123', 0),
      ).resolves.toBeUndefined();
    });

    it('throws VendorError for negative quantity', async () => {
      await expect(
        directAdapter.setQuantity(creds, 'sub-123', -1),
      ).rejects.toThrow(VendorError);
    });

    it('includes DIRECT vendorType in the error', async () => {
      try {
        await directAdapter.setQuantity(creds, 'sub-123', -5);
        expect.fail('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(VendorError);
        expect((err as VendorError).vendorType).toBe('DIRECT');
        expect((err as VendorError).message).toMatch(/non-negative/i);
      }
    });
  });

  // -- createSubscription ------------------------------------------------
  describe('createSubscription', () => {
    it('returns a VendorSubscription with a UUID externalId', async () => {
      const result = await directAdapter.createSubscription(creds, 'SKU-1', 5);

      expect(result).toEqual(
        expect.objectContaining({
          status: 'Active',
          quantity: 5,
        }),
      );
      // UUID v4 format check
      expect(result.externalId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
    });

    it('generates unique externalIds across calls', async () => {
      const a = await directAdapter.createSubscription(creds, 'SKU-1', 1);
      const b = await directAdapter.createSubscription(creds, 'SKU-1', 1);
      expect(a.externalId).not.toBe(b.externalId);
    });

    it('returns the requested quantity', async () => {
      const result = await directAdapter.createSubscription(creds, 'SKU-X', 42);
      expect(result.quantity).toBe(42);
    });

    it('throws VendorError when externalSku is empty', async () => {
      await expect(
        directAdapter.createSubscription(creds, '', 1),
      ).rejects.toThrow(VendorError);

      try {
        await directAdapter.createSubscription(creds, '', 1);
      } catch (err) {
        expect((err as VendorError).vendorType).toBe('DIRECT');
        expect((err as VendorError).message).toMatch(/externalSku/i);
      }
    });

    it('throws VendorError when quantity < 1', async () => {
      await expect(
        directAdapter.createSubscription(creds, 'SKU-1', 0),
      ).rejects.toThrow(VendorError);
    });

    it('throws VendorError when quantity is negative', async () => {
      await expect(
        directAdapter.createSubscription(creds, 'SKU-1', -3),
      ).rejects.toThrow(VendorError);

      try {
        await directAdapter.createSubscription(creds, 'SKU-1', -3);
      } catch (err) {
        expect((err as VendorError).vendorType).toBe('DIRECT');
        expect((err as VendorError).message).toMatch(/at least 1/i);
      }
    });
  });

  // -- cancelSubscription ------------------------------------------------
  describe('cancelSubscription', () => {
    it('resolves without error', async () => {
      await expect(
        directAdapter.cancelSubscription(creds, 'sub-xyz'),
      ).resolves.toBeUndefined();
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. Adapter registry
// ═══════════════════════════════════════════════════════════════════════════

describe('getAdapter', () => {
  // getAdapter expects a Prisma VendorType. Prisma string enums are compatible
  // with their literal string values, so we import the type once here to keep
  // the rest of the file free of @prisma/client imports.
  type VT = Parameters<typeof getAdapter>[0];

  it('returns pax8Adapter for PAX8', () => {
    const adapter = getAdapter('PAX8' as VT);
    expect(adapter).toBe(pax8Adapter);
  });

  it('returns ingramAdapter for INGRAM', () => {
    const adapter = getAdapter('INGRAM' as VT);
    expect(adapter).toBe(ingramAdapter);
  });

  it('returns tdSynnexAdapter for TDSYNNEX', () => {
    const adapter = getAdapter('TDSYNNEX' as VT);
    expect(adapter).toBe(tdSynnexAdapter);
  });

  it('returns directAdapter for DIRECT', () => {
    const adapter = getAdapter('DIRECT' as VT);
    expect(adapter).toBe(directAdapter);
  });

  it('every VendorType has the correct vendorType property', () => {
    const types = ['PAX8', 'INGRAM', 'TDSYNNEX', 'DIRECT'] as const;
    for (const vt of types) {
      const adapter = getAdapter(vt as VT);
      expect(adapter.vendorType).toBe(vt);
    }
  });

  it('returns an adapter that implements all five methods', () => {
    const types = ['PAX8', 'INGRAM', 'TDSYNNEX', 'DIRECT'] as const;
    for (const vt of types) {
      const adapter = getAdapter(vt as VT);
      expect(typeof adapter.getSubscriptions).toBe('function');
      expect(typeof adapter.setQuantity).toBe('function');
      expect(typeof adapter.getProductCatalog).toBe('function');
      expect(typeof adapter.createSubscription).toBe('function');
      expect(typeof adapter.cancelSubscription).toBe('function');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. decryptCredentials
// ═══════════════════════════════════════════════════════════════════════════

describe('decryptCredentials', () => {
  it('calls decrypt with the encrypted string', () => {
    decryptCredentials('encrypted-blob');
    expect(decrypt).toHaveBeenCalledWith('encrypted-blob');
  });

  it('parses the decrypted JSON into a credentials object', () => {
    const result = decryptCredentials('anything');
    expect(result).toEqual({ clientId: 'id', clientSecret: 'secret' });
  });

  it('throws if decrypt returns invalid JSON', () => {
    vi.mocked(decrypt).mockReturnValueOnce('not-json');
    expect(() => decryptCredentials('bad')).toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. Pax8 adapter — authentication guard
// ═══════════════════════════════════════════════════════════════════════════

describe('pax8Adapter authentication', () => {
  it('has vendorType "PAX8"', () => {
    expect(pax8Adapter.vendorType).toBe('PAX8');
  });

  it('throws VendorError when clientId is missing', async () => {
    await expect(
      pax8Adapter.getSubscriptions({ clientSecret: 'sec', companyId: 'co' }),
    ).rejects.toThrow(VendorError);

    try {
      await pax8Adapter.getSubscriptions({ clientSecret: 'sec', companyId: 'co' });
    } catch (err) {
      expect((err as VendorError).vendorType).toBe('PAX8');
      expect((err as VendorError).message).toMatch(/clientId/i);
    }
  });

  it('throws VendorError when clientSecret is missing', async () => {
    await expect(
      pax8Adapter.getSubscriptions({ clientId: 'id', companyId: 'co' }),
    ).rejects.toThrow(VendorError);

    try {
      await pax8Adapter.getSubscriptions({ clientId: 'id', companyId: 'co' });
    } catch (err) {
      expect((err as VendorError).vendorType).toBe('PAX8');
      expect((err as VendorError).message).toMatch(/clientSecret/i);
    }
  });

  it('throws VendorError when both credentials are missing', async () => {
    await expect(
      pax8Adapter.getSubscriptions({}),
    ).rejects.toThrow(VendorError);
  });

  it('throws VendorError with empty-string credentials', async () => {
    await expect(
      pax8Adapter.getSubscriptions({ clientId: '', clientSecret: '' }),
    ).rejects.toThrow(VendorError);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. Ingram adapter — authentication guard
// ═══════════════════════════════════════════════════════════════════════════

describe('ingramAdapter authentication', () => {
  it('has vendorType "INGRAM"', () => {
    expect(ingramAdapter.vendorType).toBe('INGRAM');
  });

  it('throws VendorError when clientId is missing', async () => {
    await expect(
      ingramAdapter.getSubscriptions({ clientSecret: 'sec', customerId: 'cust' }),
    ).rejects.toThrow(VendorError);

    try {
      await ingramAdapter.getSubscriptions({ clientSecret: 'sec', customerId: 'cust' });
    } catch (err) {
      expect((err as VendorError).vendorType).toBe('INGRAM');
      expect((err as VendorError).message).toMatch(/clientId/i);
    }
  });

  it('throws VendorError when clientSecret is missing', async () => {
    await expect(
      ingramAdapter.getSubscriptions({ clientId: 'id', customerId: 'cust' }),
    ).rejects.toThrow(VendorError);

    try {
      await ingramAdapter.getSubscriptions({ clientId: 'id', customerId: 'cust' });
    } catch (err) {
      expect((err as VendorError).vendorType).toBe('INGRAM');
      expect((err as VendorError).message).toMatch(/clientSecret/i);
    }
  });

  it('throws VendorError when both credentials are missing', async () => {
    await expect(
      ingramAdapter.getSubscriptions({}),
    ).rejects.toThrow(VendorError);
  });

  it('throws VendorError with empty-string credentials', async () => {
    await expect(
      ingramAdapter.getSubscriptions({ clientId: '', clientSecret: '' }),
    ).rejects.toThrow(VendorError);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. TD Synnex adapter — authentication guard
// ═══════════════════════════════════════════════════════════════════════════

describe('tdSynnexAdapter authentication', () => {
  it('has vendorType "TDSYNNEX"', () => {
    expect(tdSynnexAdapter.vendorType).toBe('TDSYNNEX');
  });

  it('throws VendorError when clientId is missing', async () => {
    await expect(
      tdSynnexAdapter.getSubscriptions({ clientSecret: 'sec', resellerId: 'r' }),
    ).rejects.toThrow(VendorError);

    try {
      await tdSynnexAdapter.getSubscriptions({ clientSecret: 'sec', resellerId: 'r' });
    } catch (err) {
      expect((err as VendorError).vendorType).toBe('TDSYNNEX');
      expect((err as VendorError).message).toMatch(/clientId/i);
    }
  });

  it('throws VendorError when clientSecret is missing', async () => {
    await expect(
      tdSynnexAdapter.getSubscriptions({ clientId: 'id', resellerId: 'r' }),
    ).rejects.toThrow(VendorError);

    try {
      await tdSynnexAdapter.getSubscriptions({ clientId: 'id', resellerId: 'r' });
    } catch (err) {
      expect((err as VendorError).vendorType).toBe('TDSYNNEX');
      expect((err as VendorError).message).toMatch(/clientSecret/i);
    }
  });

  it('throws VendorError when both credentials are missing', async () => {
    await expect(
      tdSynnexAdapter.getSubscriptions({}),
    ).rejects.toThrow(VendorError);
  });

  it('throws VendorError with empty-string credentials', async () => {
    await expect(
      tdSynnexAdapter.getSubscriptions({ clientId: '', clientSecret: '' }),
    ).rejects.toThrow(VendorError);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. Pax8 adapter — fetch interaction (auth succeeds)
// ═══════════════════════════════════════════════════════════════════════════

describe('pax8Adapter with mocked fetch', () => {
  const validCreds = { clientId: 'id', clientSecret: 'sec', companyId: 'co-1' };

  /** Helper: set up fetch to return a token, then respond to API calls. */
  function mockFetchForPax8(apiResponse: unknown, apiStatus = 200) {
    const tokenResponse = {
      ok: true,
      status: 200,
      json: async () => ({ access_token: 'tok-123' }),
      text: async () => '',
    } as unknown as Response;

    const apiRes = {
      ok: apiStatus >= 200 && apiStatus < 300,
      status: apiStatus,
      json: async () => apiResponse,
      text: async () => JSON.stringify(apiResponse),
    } as unknown as Response;

    const fn = vi.fn()
      .mockResolvedValueOnce(tokenResponse)  // authenticate
      .mockResolvedValue(apiRes);             // subsequent calls
    globalThis.fetch = fn;
    return fn;
  }

  it('getSubscriptions returns mapped subscriptions', async () => {
    const pax8Page = {
      page: { size: 100, totalElements: 1, totalPages: 1, number: 0 },
      content: [
        { id: 'ext-1', status: 'Active', quantity: 10 },
      ],
    };
    mockFetchForPax8(pax8Page);

    const subs = await pax8Adapter.getSubscriptions(validCreds);
    expect(subs).toHaveLength(1);
    expect(subs[0]).toEqual({
      externalId: 'ext-1',
      status: 'Active',
      quantity: 10,
    });
  });

  it('getSubscriptions maps commitmentTermEndDate', async () => {
    const pax8Page = {
      page: { size: 100, totalElements: 1, totalPages: 1, number: 0 },
      content: [
        { id: 'ext-2', status: 'Active', quantity: 5, commitmentTermEndDate: '2025-12-31' },
      ],
    };
    mockFetchForPax8(pax8Page);

    const subs = await pax8Adapter.getSubscriptions(validCreds);
    expect(subs[0]!.commitmentEndDate).toEqual(new Date('2025-12-31'));
  });

  it('throws VendorError when Pax8 auth returns non-OK', async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    } as unknown as Response);

    await expect(pax8Adapter.getSubscriptions(validCreds)).rejects.toThrow(VendorError);
  });

  it('throws VendorError when Pax8 API call fails', async () => {
    const tokenRes = {
      ok: true,
      status: 200,
      json: async () => ({ access_token: 'tok' }),
      text: async () => '',
    } as unknown as Response;

    const apiRes = {
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    } as unknown as Response;

    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(tokenRes)
      .mockResolvedValueOnce(apiRes);

    await expect(pax8Adapter.getSubscriptions(validCreds)).rejects.toThrow(VendorError);
  });

  it('throws VendorError when fetch throws a network error', async () => {
    globalThis.fetch = vi.fn().mockRejectedValueOnce(new Error('ECONNREFUSED'));

    await expect(pax8Adapter.getSubscriptions(validCreds)).rejects.toThrow(VendorError);
  });

  it('setQuantity sends PUT with quantity', async () => {
    const fetchFn = mockFetchForPax8(undefined, 204);

    await pax8Adapter.setQuantity(validCreds, 'sub-1', 25);

    // Second call (after auth) should be the PUT
    const putCall = fetchFn.mock.calls[1]!;
    expect(putCall[0]).toContain('/subscriptions/sub-1');
    expect(putCall[1]?.method).toBe('PUT');
    expect(JSON.parse(putCall[1]?.body as string)).toEqual({ quantity: 25 });
  });

  it('cancelSubscription sends DELETE', async () => {
    const fetchFn = mockFetchForPax8(undefined, 204);

    await pax8Adapter.cancelSubscription(validCreds, 'sub-1');

    const delCall = fetchFn.mock.calls[1]!;
    expect(delCall[0]).toContain('/subscriptions/sub-1');
    expect(delCall[1]?.method).toBe('DELETE');
  });

  it('createSubscription returns mapped result', async () => {
    const created = { id: 'new-1', status: 'Active', quantity: 3 };
    // Auth token + POST
    const tokenRes = {
      ok: true, status: 200,
      json: async () => ({ access_token: 'tok' }),
      text: async () => '',
    } as unknown as Response;
    const apiRes = {
      ok: true, status: 201,
      json: async () => created,
      text: async () => JSON.stringify(created),
    } as unknown as Response;

    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(tokenRes)
      .mockResolvedValueOnce(apiRes);

    const result = await pax8Adapter.createSubscription(validCreds, 'sku-abc', 3);
    expect(result).toEqual({ externalId: 'new-1', status: 'Active', quantity: 3 });
  });

  it('getSubscriptions throws when companyId is missing', async () => {
    const noCompany = { clientId: 'id', clientSecret: 'sec' };
    // Provide a working token so auth passes
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({ access_token: 'tok' }),
      text: async () => '',
    } as unknown as Response);

    await expect(pax8Adapter.getSubscriptions(noCompany)).rejects.toThrow(VendorError);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 9. Ingram adapter — fetch interaction (auth succeeds)
// ═══════════════════════════════════════════════════════════════════════════

describe('ingramAdapter with mocked fetch', () => {
  const validCreds = { clientId: 'id', clientSecret: 'sec', customerId: 'cust-1' };

  function mockFetchForIngram(apiResponse: unknown, apiStatus = 200) {
    const tokenRes = {
      ok: true, status: 200,
      json: async () => ({ access_token: 'tok-ingram' }),
      text: async () => '',
    } as unknown as Response;
    const apiRes = {
      ok: apiStatus >= 200 && apiStatus < 300,
      status: apiStatus,
      json: async () => apiResponse,
      text: async () => JSON.stringify(apiResponse),
    } as unknown as Response;

    const fn = vi.fn()
      .mockResolvedValueOnce(tokenRes)
      .mockResolvedValue(apiRes);
    globalThis.fetch = fn;
    return fn;
  }

  it('getSubscriptions returns mapped subscriptions', async () => {
    const page = {
      pagination: { currentPage: 1, totalPages: 1, pageSize: 100, totalRecords: 1 },
      items: [
        { subscriptionId: 'ig-1', status: 'Active', seatCount: 7 },
      ],
    };
    mockFetchForIngram(page);

    const subs = await ingramAdapter.getSubscriptions(validCreds);
    expect(subs).toEqual([{ externalId: 'ig-1', status: 'Active', quantity: 7 }]);
  });

  it('getSubscriptions maps commitmentEndDate', async () => {
    const page = {
      pagination: { currentPage: 1, totalPages: 1, pageSize: 100, totalRecords: 1 },
      items: [
        { subscriptionId: 'ig-2', status: 'Active', seatCount: 1, commitmentEndDate: '2026-06-30' },
      ],
    };
    mockFetchForIngram(page);

    const subs = await ingramAdapter.getSubscriptions(validCreds);
    expect(subs[0]!.commitmentEndDate).toEqual(new Date('2026-06-30'));
  });

  it('throws VendorError when customerId is missing', async () => {
    const noCust = { clientId: 'id', clientSecret: 'sec' };
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({ access_token: 'tok' }),
      text: async () => '',
    } as unknown as Response);

    await expect(ingramAdapter.getSubscriptions(noCust)).rejects.toThrow(VendorError);
  });

  it('setQuantity sends PUT with seatCount', async () => {
    const fn = mockFetchForIngram(undefined, 204);

    await ingramAdapter.setQuantity(validCreds, 'sub-ig', 12);

    const putCall = fn.mock.calls[1]!;
    expect(putCall[0]).toContain('/subscriptions/sub-ig');
    expect(putCall[1]?.method).toBe('PUT');
    expect(JSON.parse(putCall[1]?.body as string)).toEqual({ seatCount: 12 });
  });

  it('cancelSubscription sends DELETE', async () => {
    const fn = mockFetchForIngram(undefined, 204);

    await ingramAdapter.cancelSubscription(validCreds, 'sub-ig');

    const delCall = fn.mock.calls[1]!;
    expect(delCall[0]).toContain('/subscriptions/sub-ig');
    expect(delCall[1]?.method).toBe('DELETE');
  });

  it('getProductCatalog returns mapped entries', async () => {
    const page = {
      pagination: { currentPage: 1, totalPages: 1, pageSize: 100, totalRecords: 1 },
      items: [
        {
          productId: 'prod-1',
          productName: 'Microsoft 365',
          unitPrice: 12.5,
          currency: 'USD',
          availability: 'Available',
          minQuantity: 1,
          maxQuantity: 300,
        },
      ],
    };
    mockFetchForIngram(page);

    const catalog = await ingramAdapter.getProductCatalog(validCreds);
    expect(catalog).toEqual([
      {
        externalSku: 'prod-1',
        name: 'Microsoft 365',
        unitCost: '12.5',
        currency: 'USD',
        availability: 'Available',
        minQuantity: 1,
        maxQuantity: 300,
      },
    ]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 10. TD Synnex adapter — fetch interaction (auth succeeds)
// ═══════════════════════════════════════════════════════════════════════════

describe('tdSynnexAdapter with mocked fetch', () => {
  const validCreds = { clientId: 'id', clientSecret: 'sec', resellerId: 'res-1' };

  function mockFetchForTdSynnex(apiResponse: unknown, apiStatus = 200) {
    const tokenRes = {
      ok: true, status: 200,
      json: async () => ({ access_token: 'tok-td' }),
      text: async () => '',
    } as unknown as Response;
    const apiRes = {
      ok: apiStatus >= 200 && apiStatus < 300,
      status: apiStatus,
      json: async () => apiResponse,
      text: async () => JSON.stringify(apiResponse),
    } as unknown as Response;

    const fn = vi.fn()
      .mockResolvedValueOnce(tokenRes)
      .mockResolvedValue(apiRes);
    globalThis.fetch = fn;
    return fn;
  }

  it('getSubscriptions returns mapped subscriptions', async () => {
    const page = {
      pagination: { currentPage: 1, totalPages: 1, pageSize: 100, totalRecords: 1 },
      items: [
        { subscriptionId: 'td-1', status: 'Active', quantity: 20 },
      ],
    };
    mockFetchForTdSynnex(page);

    const subs = await tdSynnexAdapter.getSubscriptions(validCreds);
    expect(subs).toEqual([{ externalId: 'td-1', status: 'Active', quantity: 20 }]);
  });

  it('getSubscriptions maps commitmentEndDate', async () => {
    const page = {
      pagination: { currentPage: 1, totalPages: 1, pageSize: 100, totalRecords: 1 },
      items: [
        { subscriptionId: 'td-2', status: 'Active', quantity: 1, commitmentEndDate: '2027-01-15' },
      ],
    };
    mockFetchForTdSynnex(page);

    const subs = await tdSynnexAdapter.getSubscriptions(validCreds);
    expect(subs[0]!.commitmentEndDate).toEqual(new Date('2027-01-15'));
  });

  it('throws VendorError when resellerId is missing', async () => {
    const noReseller = { clientId: 'id', clientSecret: 'sec' };
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({ access_token: 'tok' }),
      text: async () => '',
    } as unknown as Response);

    await expect(tdSynnexAdapter.getSubscriptions(noReseller)).rejects.toThrow(VendorError);
  });

  it('setQuantity sends PUT with quantity', async () => {
    const fn = mockFetchForTdSynnex(undefined, 204);

    await tdSynnexAdapter.setQuantity(validCreds, 'sub-td', 15);

    const putCall = fn.mock.calls[1]!;
    expect(putCall[0]).toContain('/subscriptions/sub-td');
    expect(putCall[1]?.method).toBe('PUT');
    expect(JSON.parse(putCall[1]?.body as string)).toEqual({ quantity: 15 });
  });

  it('cancelSubscription sends DELETE', async () => {
    const fn = mockFetchForTdSynnex(undefined, 204);

    await tdSynnexAdapter.cancelSubscription(validCreds, 'sub-td');

    const delCall = fn.mock.calls[1]!;
    expect(delCall[0]).toContain('/subscriptions/sub-td');
    expect(delCall[1]?.method).toBe('DELETE');
  });

  it('getProductCatalog maps sku and resellerPrice', async () => {
    const page = {
      pagination: { currentPage: 1, totalPages: 1, pageSize: 100, totalRecords: 1 },
      items: [
        {
          sku: 'TDS-SKU-1',
          productName: 'Azure Plan',
          resellerPrice: 99.99,
          currency: 'USD',
          availability: 'Available',
          minQuantity: 1,
          maxQuantity: 9999,
        },
      ],
    };
    mockFetchForTdSynnex(page);

    const catalog = await tdSynnexAdapter.getProductCatalog(validCreds);
    expect(catalog).toEqual([
      {
        externalSku: 'TDS-SKU-1',
        name: 'Azure Plan',
        unitCost: '99.99',
        currency: 'USD',
        availability: 'Available',
        minQuantity: 1,
        maxQuantity: 9999,
      },
    ]);
  });

  it('createSubscription returns mapped result', async () => {
    const created = { subscriptionId: 'td-new', status: 'Active', quantity: 8 };
    const tokenRes = {
      ok: true, status: 200,
      json: async () => ({ access_token: 'tok' }),
      text: async () => '',
    } as unknown as Response;
    const apiRes = {
      ok: true, status: 201,
      json: async () => created,
      text: async () => JSON.stringify(created),
    } as unknown as Response;

    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(tokenRes)
      .mockResolvedValueOnce(apiRes);

    const result = await tdSynnexAdapter.createSubscription(validCreds, 'TDS-SKU-1', 8);
    expect(result).toEqual({ externalId: 'td-new', status: 'Active', quantity: 8 });
  });

  it('createSubscription throws when resellerId is missing', async () => {
    const noReseller = { clientId: 'id', clientSecret: 'sec' };
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({ access_token: 'tok' }),
      text: async () => '',
    } as unknown as Response);

    await expect(
      tdSynnexAdapter.createSubscription(noReseller, 'SKU', 1),
    ).rejects.toThrow(VendorError);
  });
});

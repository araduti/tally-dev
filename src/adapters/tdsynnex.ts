import type {
  VendorAdapter,
  VendorCatalogEntry,
  VendorCredentials,
  VendorMutationOptions,
  VendorSubscription,
} from './types';
import { VendorError } from './types';

const TDSYNNEX_API_BASE = 'https://api.tdsynnex.com/cloud/v1';
const TDSYNNEX_TOKEN_URL = 'https://api.tdsynnex.com/oauth/token';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Authenticate with TD Synnex StreamOne Ion using OAuth2 client_credentials
 * and return an access token. The token is short-lived and should be requested
 * per operation rather than cached across requests.
 */
async function authenticate(credentials: VendorCredentials): Promise<string> {
  const { clientId, clientSecret } = credentials;

  if (!clientId || !clientSecret) {
    throw new VendorError(
      'TDSYNNEX',
      null,
      'Missing required TD Synnex credentials: clientId and clientSecret',
    );
  }

  let response: Response;
  try {
    response = await fetch(TDSYNNEX_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'client_credentials',
      }).toString(),
    });
  } catch (error: unknown) {
    throw new VendorError(
      'TDSYNNEX',
      error,
      'Failed to connect to TD Synnex authentication endpoint',
    );
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new VendorError(
      'TDSYNNEX',
      { status: response.status, body },
      `TD Synnex authentication failed (HTTP ${response.status})`,
    );
  }

  const data: unknown = await response.json();
  const token = (data as { access_token?: string }).access_token;

  if (!token) {
    throw new VendorError(
      'TDSYNNEX',
      data,
      'TD Synnex authentication response missing access_token',
    );
  }

  return token;
}

/**
 * Perform an authenticated request against the TD Synnex StreamOne Ion API.
 * Automatically handles JSON serialisation / deserialisation.
 */
async function tdSynnexFetch<T>(
  token: string,
  path: string,
  options: {
    method?: string;
    body?: unknown;
    params?: Record<string, string>;
    idempotencyKey?: string;
  } = {},
): Promise<T> {
  const { method = 'GET', body, params, idempotencyKey } = options;

  let url = `${TDSYNNEX_API_BASE}${path}`;
  if (params) {
    const qs = new URLSearchParams(params);
    url = `${url}?${qs.toString()}`;
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };

  if (idempotencyKey) {
    headers['Idempotency-Key'] = idempotencyKey;
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch (error: unknown) {
    throw new VendorError(
      'TDSYNNEX',
      error,
      `TD Synnex API request failed: ${method} ${path}`,
    );
  }

  if (!response.ok) {
    const responseBody = await response.text().catch(() => '');
    throw new VendorError(
      'TDSYNNEX',
      { status: response.status, body: responseBody },
      `TD Synnex API error (HTTP ${response.status}): ${method} ${path}`,
    );
  }

  // 204 No Content — nothing to parse
  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// TD Synnex StreamOne Ion API response shapes (internal, not exported)
// ---------------------------------------------------------------------------

interface TdSynnexSubscription {
  subscriptionId: string;
  status: string;
  quantity: number;
  commitmentEndDate?: string;
}

interface TdSynnexPagination {
  currentPage: number;
  totalPages: number;
  pageSize: number;
  totalRecords: number;
}

interface TdSynnexPaginatedResponse<T> {
  pagination: TdSynnexPagination;
  items: T[];
}

interface TdSynnexProduct {
  sku: string;
  productName: string;
  resellerPrice?: number;
  currency?: string;
  availability?: string;
  minQuantity?: number;
  maxQuantity?: number;
}

// ---------------------------------------------------------------------------
// Helpers to map TD Synnex responses → Tally models
// ---------------------------------------------------------------------------

function toVendorSubscription(sub: TdSynnexSubscription): VendorSubscription {
  return {
    externalId: sub.subscriptionId,
    status: sub.status,
    quantity: sub.quantity,
    ...(sub.commitmentEndDate
      ? { commitmentEndDate: new Date(sub.commitmentEndDate) }
      : {}),
  };
}

function toVendorCatalogEntry(product: TdSynnexProduct): VendorCatalogEntry {
  return {
    externalSku: product.sku,
    name: product.productName,
    unitCost: product.resellerPrice != null ? String(product.resellerPrice) : '0',
    currency: product.currency ?? 'USD',
    availability: product.availability ?? 'Available',
    ...(product.minQuantity != null ? { minQuantity: product.minQuantity } : {}),
    ...(product.maxQuantity != null ? { maxQuantity: product.maxQuantity } : {}),
  };
}

// ---------------------------------------------------------------------------
// Adapter implementation
// ---------------------------------------------------------------------------

export const tdSynnexAdapter: VendorAdapter = {
  vendorType: 'TDSYNNEX',

  // -----------------------------------------------------------------------
  // getSubscriptions
  // -----------------------------------------------------------------------
  async getSubscriptions(credentials: VendorCredentials): Promise<VendorSubscription[]> {
    const token = await authenticate(credentials);
    const { resellerId } = credentials;

    if (!resellerId) {
      throw new VendorError('TDSYNNEX', null, 'Missing required TD Synnex credential: resellerId');
    }

    const allSubscriptions: VendorSubscription[] = [];
    let page = 1;
    let totalPages = 1;

    while (page <= totalPages) {
      const result = await tdSynnexFetch<TdSynnexPaginatedResponse<TdSynnexSubscription>>(
        token,
        '/subscriptions',
        {
          params: {
            resellerId,
            pageNumber: String(page),
            pageSize: '100',
          },
        },
      );

      totalPages = result.pagination.totalPages;
      for (const sub of result.items) {
        allSubscriptions.push(toVendorSubscription(sub));
      }

      page += 1;
    }

    return allSubscriptions;
  },

  // -----------------------------------------------------------------------
  // setQuantity
  // -----------------------------------------------------------------------
  async setQuantity(
    credentials: VendorCredentials,
    externalSubscriptionId: string,
    quantity: number,
    options?: VendorMutationOptions,
  ): Promise<void> {
    const token = await authenticate(credentials);

    await tdSynnexFetch<void>(token, `/subscriptions/${externalSubscriptionId}`, {
      method: 'PUT',
      body: { quantity },
      idempotencyKey: options?.idempotencyKey,
    });
  },

  // -----------------------------------------------------------------------
  // getProductCatalog
  // -----------------------------------------------------------------------
  async getProductCatalog(credentials: VendorCredentials): Promise<VendorCatalogEntry[]> {
    const token = await authenticate(credentials);

    const catalog: VendorCatalogEntry[] = [];
    let page = 1;
    let totalPages = 1;

    while (page <= totalPages) {
      const result = await tdSynnexFetch<TdSynnexPaginatedResponse<TdSynnexProduct>>(
        token,
        '/products',
        {
          params: {
            pageNumber: String(page),
            pageSize: '100',
          },
        },
      );

      totalPages = result.pagination.totalPages;

      for (const product of result.items) {
        catalog.push(toVendorCatalogEntry(product));
      }

      page += 1;
    }

    return catalog;
  },

  // -----------------------------------------------------------------------
  // createSubscription
  // -----------------------------------------------------------------------
  async createSubscription(
    credentials: VendorCredentials,
    externalSku: string,
    quantity: number,
    options?: VendorMutationOptions,
  ): Promise<VendorSubscription> {
    const token = await authenticate(credentials);
    const { resellerId } = credentials;

    if (!resellerId) {
      throw new VendorError('TDSYNNEX', null, 'Missing required TD Synnex credential: resellerId');
    }

    const created = await tdSynnexFetch<TdSynnexSubscription>(token, '/subscriptions', {
      method: 'POST',
      body: {
        resellerId,
        sku: externalSku,
        quantity,
        // Use UTC date string to avoid timezone drift
        startDate: new Date().toISOString().slice(0, 10),
      },
      idempotencyKey: options?.idempotencyKey,
    });

    return toVendorSubscription(created);
  },

  // -----------------------------------------------------------------------
  // cancelSubscription
  // -----------------------------------------------------------------------
  async cancelSubscription(
    credentials: VendorCredentials,
    externalSubscriptionId: string,
    options?: VendorMutationOptions,
  ): Promise<void> {
    const token = await authenticate(credentials);

    await tdSynnexFetch<void>(token, `/subscriptions/${externalSubscriptionId}`, {
      method: 'DELETE',
      idempotencyKey: options?.idempotencyKey,
    });
  },
};

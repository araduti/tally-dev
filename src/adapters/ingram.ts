import type {
  VendorAdapter,
  VendorCatalogEntry,
  VendorCredentials,
  VendorMutationOptions,
  VendorSubscription,
} from './types';
import { VendorError } from './types';

const INGRAM_API_BASE = process.env.INGRAM_API_BASE ?? 'https://api.ingrammicro.com/resellers/v6';
const INGRAM_TOKEN_URL = 'https://api.ingrammicro.com/oauth/access_token';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Authenticate with Ingram Micro using OAuth2 client_credentials and return an
 * access token. The token is short-lived and should be requested per
 * operation rather than cached across requests.
 */
async function authenticate(credentials: VendorCredentials): Promise<string> {
  const { clientId, clientSecret } = credentials;

  if (!clientId || !clientSecret) {
    throw new VendorError(
      'INGRAM',
      null,
      'Missing required Ingram Micro credentials: clientId and clientSecret',
    );
  }

  let response: Response;
  try {
    response = await fetch(INGRAM_TOKEN_URL, {
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
      'INGRAM',
      error,
      'Failed to connect to Ingram Micro authentication endpoint',
    );
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new VendorError(
      'INGRAM',
      { status: response.status, body },
      `Ingram Micro authentication failed (HTTP ${response.status})`,
    );
  }

  const data: unknown = await response.json();
  const token = (data as { access_token?: string }).access_token;

  if (!token) {
    throw new VendorError(
      'INGRAM',
      data,
      'Ingram Micro authentication response missing access_token',
    );
  }

  return token;
}

/**
 * Perform an authenticated request against the Ingram Micro Resellers v6 API.
 * Automatically handles JSON serialisation / deserialisation.
 */
async function ingramFetch<T>(
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

  let url = `${INGRAM_API_BASE}${path}`;
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
      'INGRAM',
      error,
      `Ingram Micro API request failed: ${method} ${path}`,
    );
  }

  if (!response.ok) {
    const responseBody = await response.text().catch(() => '');
    throw new VendorError(
      'INGRAM',
      { status: response.status, body: responseBody },
      `Ingram Micro API error (HTTP ${response.status}): ${method} ${path}`,
    );
  }

  // 204 No Content — nothing to parse
  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Ingram Micro API response shapes (internal, not exported)
// ---------------------------------------------------------------------------

interface IngramSubscription {
  subscriptionId: string;
  status: string;
  seatCount: number;
  commitmentEndDate?: string;
}

interface IngramPagination {
  currentPage: number;
  totalPages: number;
  pageSize: number;
  totalRecords: number;
}

interface IngramPaginatedResponse<T> {
  pagination: IngramPagination;
  items: T[];
}

interface IngramProduct {
  productId: string;
  productName: string;
  unitPrice?: number;
  currency?: string;
  availability?: string;
  minQuantity?: number;
  maxQuantity?: number;
}

interface IngramCreatedSubscription {
  subscriptionId: string;
  status: string;
  seatCount: number;
  commitmentEndDate?: string;
}

// ---------------------------------------------------------------------------
// Helpers to map Ingram Micro responses → Tally models
// ---------------------------------------------------------------------------

function toVendorSubscription(sub: IngramSubscription): VendorSubscription {
  return {
    externalId: sub.subscriptionId,
    status: sub.status,
    quantity: sub.seatCount,
    ...(sub.commitmentEndDate
      ? { commitmentEndDate: new Date(sub.commitmentEndDate) }
      : {}),
  };
}

function toVendorCatalogEntry(product: IngramProduct): VendorCatalogEntry {
  return {
    externalSku: product.productId,
    name: product.productName,
    unitCost: product.unitPrice != null ? String(product.unitPrice) : '0',
    currency: product.currency ?? 'USD',
    availability: product.availability ?? 'Available',
    ...(product.minQuantity != null ? { minQuantity: product.minQuantity } : {}),
    ...(product.maxQuantity != null ? { maxQuantity: product.maxQuantity } : {}),
  };
}

// ---------------------------------------------------------------------------
// Adapter implementation
// ---------------------------------------------------------------------------

export const ingramAdapter: VendorAdapter = {
  vendorType: 'INGRAM',

  // -----------------------------------------------------------------------
  // getSubscriptions
  // -----------------------------------------------------------------------
  async getSubscriptions(credentials: VendorCredentials): Promise<VendorSubscription[]> {
    const token = await authenticate(credentials);
    const { customerId } = credentials;

    if (!customerId) {
      throw new VendorError('INGRAM', null, 'Missing required Ingram Micro credential: customerId');
    }

    const allSubscriptions: VendorSubscription[] = [];
    let page = 1;
    let totalPages = 1;

    while (page <= totalPages) {
      const result = await ingramFetch<IngramPaginatedResponse<IngramSubscription>>(
        token,
        '/subscriptions',
        {
          params: {
            customerId,
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

    await ingramFetch<void>(token, `/subscriptions/${externalSubscriptionId}`, {
      method: 'PUT',
      body: { seatCount: quantity },
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
      const result = await ingramFetch<IngramPaginatedResponse<IngramProduct>>(
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
    const { customerId } = credentials;

    if (!customerId) {
      throw new VendorError('INGRAM', null, 'Missing required Ingram Micro credential: customerId');
    }

    const created = await ingramFetch<IngramCreatedSubscription>(token, '/subscriptions', {
      method: 'POST',
      body: {
        customerId,
        productId: externalSku,
        seatCount: quantity,
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

    await ingramFetch<void>(token, `/subscriptions/${externalSubscriptionId}`, {
      method: 'DELETE',
      idempotencyKey: options?.idempotencyKey,
    });
  },
};

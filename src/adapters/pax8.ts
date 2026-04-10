import type {
  VendorAdapter,
  VendorCatalogEntry,
  VendorCredentials,
  VendorSubscription,
} from './types';
import { VendorError } from './types';

const PAX8_API_BASE = 'https://api.pax8.com/v3';
const PAX8_TOKEN_URL = 'https://login.pax8.com/oauth/token';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Authenticate with Pax8 using OAuth2 client_credentials and return an
 * access token. The token is short-lived and should be requested per
 * operation rather than cached across requests.
 */
async function authenticate(credentials: VendorCredentials): Promise<string> {
  const { clientId, clientSecret } = credentials;

  if (!clientId || !clientSecret) {
    throw new VendorError(
      'PAX8',
      null,
      'Missing required Pax8 credentials: clientId and clientSecret',
    );
  }

  let response: Response;
  try {
    response = await fetch(PAX8_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        audience: 'api://p8p.client',
        grant_type: 'client_credentials',
      }),
    });
  } catch (error: unknown) {
    throw new VendorError('PAX8', error, 'Failed to connect to Pax8 authentication endpoint');
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new VendorError(
      'PAX8',
      { status: response.status, body },
      `Pax8 authentication failed (HTTP ${response.status})`,
    );
  }

  const data: unknown = await response.json();
  const token = (data as { access_token?: string }).access_token;

  if (!token) {
    throw new VendorError('PAX8', data, 'Pax8 authentication response missing access_token');
  }

  return token;
}

/**
 * Perform an authenticated request against the Pax8 v3 REST API.
 * Automatically handles JSON serialisation / deserialisation.
 */
async function pax8Fetch<T>(
  token: string,
  path: string,
  options: {
    method?: string;
    body?: unknown;
    params?: Record<string, string>;
  } = {},
): Promise<T> {
  const { method = 'GET', body, params } = options;

  let url = `${PAX8_API_BASE}${path}`;
  if (params) {
    const qs = new URLSearchParams(params);
    url = `${url}?${qs.toString()}`;
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch (error: unknown) {
    throw new VendorError('PAX8', error, `Pax8 API request failed: ${method} ${path}`);
  }

  if (!response.ok) {
    const responseBody = await response.text().catch(() => '');
    throw new VendorError(
      'PAX8',
      { status: response.status, body: responseBody },
      `Pax8 API error (HTTP ${response.status}): ${method} ${path}`,
    );
  }

  // 204 No Content — nothing to parse
  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Pax8 API response shapes (internal, not exported)
// ---------------------------------------------------------------------------

interface Pax8Subscription {
  id: string;
  status: string;
  quantity: number;
  commitmentTermEndDate?: string;
}

interface Pax8PaginatedResponse<T> {
  page: {
    size: number;
    totalElements: number;
    totalPages: number;
    number: number;
  };
  content: T[];
}

interface Pax8Product {
  id: string;
  name: string;
}

interface Pax8Pricing {
  unitPrice: number;
  currency: string;
}

interface Pax8ProductPricing {
  prices: Pax8Pricing[];
}

// ---------------------------------------------------------------------------
// Helpers to map Pax8 responses → Tally models
// ---------------------------------------------------------------------------

function toVendorSubscription(sub: Pax8Subscription): VendorSubscription {
  return {
    externalId: sub.id,
    status: sub.status,
    quantity: sub.quantity,
    ...(sub.commitmentTermEndDate
      ? { commitmentEndDate: new Date(sub.commitmentTermEndDate) }
      : {}),
  };
}

// ---------------------------------------------------------------------------
// Adapter implementation
// ---------------------------------------------------------------------------

export const pax8Adapter: VendorAdapter = {
  vendorType: 'PAX8',

  // -----------------------------------------------------------------------
  // getSubscriptions
  // -----------------------------------------------------------------------
  async getSubscriptions(credentials: VendorCredentials): Promise<VendorSubscription[]> {
    const token = await authenticate(credentials);
    const { companyId } = credentials;

    if (!companyId) {
      throw new VendorError('PAX8', null, 'Missing required Pax8 credential: companyId');
    }

    const allSubscriptions: VendorSubscription[] = [];
    let page = 0;
    let totalPages = 1;

    while (page < totalPages) {
      const result = await pax8Fetch<Pax8PaginatedResponse<Pax8Subscription>>(
        token,
        '/subscriptions',
        {
          params: {
            companyId,
            page: String(page),
            size: '100',
          },
        },
      );

      totalPages = result.page.totalPages;
      for (const sub of result.content) {
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
  ): Promise<void> {
    const token = await authenticate(credentials);

    await pax8Fetch<void>(token, `/subscriptions/${externalSubscriptionId}`, {
      method: 'PUT',
      body: { quantity },
    });
  },

  // -----------------------------------------------------------------------
  // getProductCatalog
  // -----------------------------------------------------------------------
  async getProductCatalog(credentials: VendorCredentials): Promise<VendorCatalogEntry[]> {
    const token = await authenticate(credentials);

    const catalog: VendorCatalogEntry[] = [];
    let page = 0;
    let totalPages = 1;

    while (page < totalPages) {
      const result = await pax8Fetch<Pax8PaginatedResponse<Pax8Product>>(token, '/products', {
        params: {
          page: String(page),
          size: '100',
        },
      });

      totalPages = result.page.totalPages;

      for (const product of result.content) {
        // Fetch pricing for each product so we can populate unitCost
        let pricing: Pax8ProductPricing | undefined;
        try {
          pricing = await pax8Fetch<Pax8ProductPricing>(
            token,
            `/products/${product.id}/pricing`,
          );
        } catch {
          // If pricing lookup fails we still include the product with a
          // zero cost rather than failing the entire catalog sync.
          pricing = undefined;
        }

        const price = pricing?.prices?.[0];

        catalog.push({
          externalSku: product.id,
          name: product.name,
          unitCost: price?.unitPrice != null ? String(price.unitPrice) : '0',
          currency: price?.currency ?? 'USD',
          availability: 'Available',
        });
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
  ): Promise<VendorSubscription> {
    const token = await authenticate(credentials);
    const { companyId } = credentials;

    if (!companyId) {
      throw new VendorError('PAX8', null, 'Missing required Pax8 credential: companyId');
    }

    const created = await pax8Fetch<Pax8Subscription>(token, '/subscriptions', {
      method: 'POST',
      body: {
        companyId,
        productId: externalSku,
        quantity,
        billingTerm: 'Monthly',
        startDate: new Date().toISOString().split('T')[0],
      },
    });

    return toVendorSubscription(created);
  },

  // -----------------------------------------------------------------------
  // cancelSubscription
  // -----------------------------------------------------------------------
  async cancelSubscription(
    credentials: VendorCredentials,
    externalSubscriptionId: string,
  ): Promise<void> {
    const token = await authenticate(credentials);

    await pax8Fetch<void>(token, `/subscriptions/${externalSubscriptionId}`, {
      method: 'DELETE',
    });
  },
};

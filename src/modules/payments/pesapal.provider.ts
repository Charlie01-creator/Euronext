import { env } from '../../config/env';
import { ApiError } from '../../utils/ApiError';
import { logger } from '../../config/logger';
import { redis } from '../../lib/redis';

const BASE_URL = env.PESAPAL_BASE_URL;

const TOKEN_CACHE_KEY = 'pesapal:access_token';
const TOKEN_TTL_SECONDS = 60 * 4; // Pesapal tokens are short-lived; caching for 4 min stays safely under expiry
const IPN_ID_CACHE_KEY = 'pesapal:ipn_id';

interface PesapalTokenResponse {
  token: string;
  expiryDate: string;
  error: unknown;
  status: string;
  message: string;
}

async function pesapalRequest<T>(path: string, init: RequestInit & { auth?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...(init.headers as Record<string, string>),
  };

  if (init.auth !== false) {
    const token = await getAccessToken();
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(`${BASE_URL}${path}`, { ...init, headers });
  const json = await res.json().catch(() => ({}));

  if (!res.ok || json.error) {
    logger.error({ path, response: json }, 'Pesapal request failed');
    throw ApiError.badRequest(json.message || json.error?.message || 'Payment provider request failed');
  }

  return json as T;
}

/** Requests (or returns a cached) bearer token. Not tied to a user — this authenticates the app itself to Pesapal. */
async function getAccessToken(): Promise<string> {
  const cached = await redis.get(TOKEN_CACHE_KEY);
  if (cached) return cached;

  const res = await fetch(`${BASE_URL}/api/Auth/RequestToken`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      consumer_key: env.PESAPAL_CONSUMER_KEY,
      consumer_secret: env.PESAPAL_CONSUMER_SECRET,
    }),
  });
  const json = (await res.json()) as PesapalTokenResponse;

  if (!res.ok || json.error || !json.token) {
    logger.error({ response: json }, 'Pesapal authentication failed');
    throw ApiError.internal('Unable to authenticate with the payment provider');
  }

  await redis.set(TOKEN_CACHE_KEY, json.token, 'EX', TOKEN_TTL_SECONDS);
  return json.token;
}

interface RegisterIpnResponse {
  url: string;
  created_date: string;
  ipn_id: string;
  error: unknown;
  status: string;
}

/**
 * IPN (Instant Payment Notification) registration only needs to happen once per callback URL —
 * Pesapal returns an ipn_id that every subsequent order submission references. Cached indefinitely
 * (no TTL) since it only changes if APP_BASE_URL changes, which would be a deliberate redeploy,
 * not something that should silently expire and break payments.
 */
async function ensureIpnRegistered(): Promise<string> {
  const cached = await redis.get(IPN_ID_CACHE_KEY);
  if (cached) return cached;

  const ipnUrl = `${env.APP_BASE_URL}${env.API_BASE_URL}/payments/ipn/pesapal`;
  const json = await pesapalRequest<RegisterIpnResponse>('/api/URLSetup/RegisterIPN', {
    method: 'POST',
    body: JSON.stringify({ url: ipnUrl, ipn_notification_type: 'POST' }),
  });

  await redis.set(IPN_ID_CACHE_KEY, json.ipn_id); // no TTL — see comment above
  return json.ipn_id;
}

interface SubmitOrderParams {
  merchantReference: string; // our own Transaction.providerRef — Pesapal calls this orderMerchantReference
  amount: number;
  currency: string;
  description: string;
  email: string;
  phone?: string;
  firstName: string;
  lastName: string;
  countryCode: string; // ISO 3166-1 alpha-2, e.g. 'UG', 'KE', 'TZ'
}

interface SubmitOrderResponse {
  order_tracking_id: string;
  merchant_reference: string;
  redirect_url: string;
  error: unknown;
  status: string;
}

/** Submits an order and returns the hosted-checkout redirect URL — Pesapal shows every available payment method (mobile money, card, bank) on that one page; the app never picks a method up front the way the previous Flutterwave integration had to. */
export async function submitOrder(params: SubmitOrderParams): Promise<SubmitOrderResponse> {
  const notificationId = await ensureIpnRegistered();

  return pesapalRequest<SubmitOrderResponse>('/api/Transactions/SubmitOrderRequest', {
    method: 'POST',
    body: JSON.stringify({
      id: params.merchantReference,
      currency: params.currency,
      amount: params.amount,
      description: params.description,
      callback_url: `${env.APP_BASE_URL}/nexus-dashboard-mobile.html`,
      notification_id: notificationId,
      billing_address: {
        email_address: params.email,
        phone_number: params.phone,
        country_code: params.countryCode,
        first_name: params.firstName,
        last_name: params.lastName,
      },
    }),
  });
}

export type PesapalPaymentStatus = 'COMPLETED' | 'FAILED' | 'INVALID' | 'PENDING' | 'REVERSED';

interface TransactionStatusResponse {
  payment_method: string;
  amount: number;
  created_date: string;
  confirmation_code: string;
  payment_status_description: PesapalPaymentStatus;
  description: string;
  message: string;
  payment_account: string;
  status_code: number;
  merchant_reference: string;
  currency: string;
  error: unknown;
  status: string;
}

/** Never trust the IPN callback's claim alone — always re-verify directly with Pesapal before crediting anything, same principle the Flutterwave integration followed. */
export async function getTransactionStatus(orderTrackingId: string): Promise<TransactionStatusResponse> {
  return pesapalRequest<TransactionStatusResponse>(
    `/api/Transactions/GetTransactionStatus?orderTrackingId=${encodeURIComponent(orderTrackingId)}`,
    { method: 'GET' }
  );
}

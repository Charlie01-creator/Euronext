import crypto from 'crypto';
import { env } from '../../config/env';
import { ApiError } from '../../utils/ApiError';
import { logger } from '../../config/logger';

const BASE_URL = env.FLUTTERWAVE_BASE_URL;

function authHeaders() {
  return {
    Authorization: `Bearer ${env.FLUTTERWAVE_SECRET_KEY}`,
    'Content-Type': 'application/json',
  };
}

async function flutterwaveRequest<T>(path: string, init: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, { ...init, headers: { ...authHeaders(), ...init.headers } });
  const json = await res.json();

  if (!res.ok || json.status === 'error') {
    logger.error({ path, response: json }, 'Flutterwave request failed');
    throw ApiError.badRequest(json.message || 'Payment provider request failed');
  }

  return json as T;
}

export type MobileMoneyNetwork = 'MTN' | 'AIRTEL';

interface MobileMoneyChargeParams {
  amountUsd: number;
  currency: string;
  phone: string;
  email: string;
  network: MobileMoneyNetwork;
  txRef: string;
  fullName: string;
}

interface FlutterwaveChargeResponse {
  status: string;
  message: string;
  data: {
    id: number;
    tx_ref: string;
    status: string;
    processor_response?: string;
  };
}

/**
 * Initiates an MTN/Airtel Mobile Money collection via Flutterwave's Uganda mobile money charge
 * endpoint. Flutterwave sends the USSD/PIN prompt directly to the customer's phone — this backend
 * never sees or stores a PIN.
 */
export async function chargeMobileMoney(params: MobileMoneyChargeParams) {
  return flutterwaveRequest<FlutterwaveChargeResponse>('/charges?type=mobile_money_uganda', {
    method: 'POST',
    body: JSON.stringify({
      tx_ref: params.txRef,
      amount: params.amountUsd,
      currency: params.currency,
      email: params.email,
      phone_number: params.phone,
      fullname: params.fullName,
      network: params.network,
    }),
  });
}

interface HostedCheckoutParams {
  amountUsd: number;
  currency: string;
  email: string;
  fullName: string;
  txRef: string;
  redirectUrl: string;
}

interface FlutterwaveHostedCheckoutResponse {
  status: string;
  message: string;
  data: { link: string };
}

/**
 * For Card and Bank Transfer, we never collect card/bank credentials ourselves (PCI scope stays
 * with Flutterwave). Instead we request a hosted checkout link and redirect the user there.
 */
export async function createHostedCheckout(params: HostedCheckoutParams) {
  return flutterwaveRequest<FlutterwaveHostedCheckoutResponse>('/payments', {
    method: 'POST',
    body: JSON.stringify({
      tx_ref: params.txRef,
      amount: params.amountUsd,
      currency: params.currency,
      redirect_url: params.redirectUrl,
      customer: { email: params.email, name: params.fullName },
      customizations: { title: 'NexusCapital', description: 'Investment platform payment' },
    }),
  });
}

interface PayoutParams {
  amountUsd: number;
  currency: string;
  narration: string;
  reference: string;
  // mobile money payout destination
  phone?: string;
  network?: MobileMoneyNetwork;
  // bank payout destination
  accountNumber?: string;
  bankCode?: string;
}

interface FlutterwavePayoutResponse {
  status: string;
  message: string;
  data: { id: number; reference: string; status: string };
}

/** Pays a withdrawal out to MTN/Airtel mobile money or a bank account via Flutterwave Transfers. */
export async function initiatePayout(params: PayoutParams) {
  const isBank = Boolean(params.accountNumber);

  return flutterwaveRequest<FlutterwavePayoutResponse>('/transfers', {
    method: 'POST',
    body: JSON.stringify(
      isBank
        ? {
            account_bank: params.bankCode,
            account_number: params.accountNumber,
            amount: params.amountUsd,
            currency: params.currency,
            narration: params.narration,
            reference: params.reference,
          }
        : {
            account_bank: params.network === 'MTN' ? 'MPS' : 'ATL', // Flutterwave mobile money payout codes (Uganda)
            account_number: params.phone,
            amount: params.amountUsd,
            currency: params.currency,
            narration: params.narration,
            reference: params.reference,
          }
    ),
  });
}

/** Verifies a transaction directly with Flutterwave rather than trusting the webhook payload alone. */
export async function verifyTransaction(transactionId: string) {
  return flutterwaveRequest<{ status: string; data: { status: string; amount: number; currency: string; tx_ref: string } }>(
    `/transactions/${transactionId}/verify`,
    { method: 'GET' }
  );
}

/** Verifies the `verif-hash` header Flutterwave sends on every webhook against our configured secret. */
export function verifyWebhookSignature(headerHash: string | undefined): boolean {
  if (!headerHash || !env.FLUTTERWAVE_WEBHOOK_SECRET_HASH) return false;
  const a = Buffer.from(headerHash);
  const b = Buffer.from(env.FLUTTERWAVE_WEBHOOK_SECRET_HASH);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

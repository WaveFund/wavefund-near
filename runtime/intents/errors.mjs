// Stable error codes for the NEAR Intents (1Click) provider client.
// The client never retries. `retryable` is advice for the coordinator, not an instruction.
export const ERROR_CODES = Object.freeze({
  INVALID_ORDER: 'INVALID_ORDER',
  ORDER_EXPIRED: 'ORDER_EXPIRED',
  EXECUTION_QUOTES_DISABLED: 'EXECUTION_QUOTES_DISABLED',
  UNSUPPORTED_ASSET: 'UNSUPPORTED_ASSET',
  ASSET_CHAIN_MISMATCH: 'ASSET_CHAIN_MISMATCH',
  UNSUPPORTED_ROUTE: 'UNSUPPORTED_ROUTE',
  NO_LIQUIDITY: 'NO_LIQUIDITY',
  QUOTING_UNAVAILABLE: 'QUOTING_UNAVAILABLE',
  EVIDENCE_UNAVAILABLE: 'EVIDENCE_UNAVAILABLE',
  DELIVERY_NOT_PROVEN: 'DELIVERY_NOT_PROVEN',
  AMOUNT_TOO_LOW: 'AMOUNT_TOO_LOW',
  PROVIDER_REJECTED: 'PROVIDER_REJECTED',
  UNAUTHORIZED: 'UNAUTHORIZED',
  NOT_FOUND: 'NOT_FOUND',
  RATE_LIMITED: 'RATE_LIMITED',
  TIMEOUT: 'TIMEOUT',
  TRANSPORT_FAILED: 'TRANSPORT_FAILED',
  PROVIDER_UNAVAILABLE: 'PROVIDER_UNAVAILABLE',
  MALFORMED_RESPONSE: 'MALFORMED_RESPONSE',
  SIGNATURE_INVALID: 'SIGNATURE_INVALID',
  ORDER_MISMATCH: 'ORDER_MISMATCH',
  QUOTE_BELOW_MINIMUM: 'QUOTE_BELOW_MINIMUM',
  QUOTE_EXPIRED: 'QUOTE_EXPIRED',
  UNKNOWN_STATUS: 'UNKNOWN_STATUS',
});

const RETRYABLE = new Set(['RATE_LIMITED', 'TIMEOUT', 'TRANSPORT_FAILED', 'PROVIDER_UNAVAILABLE', 'NO_LIQUIDITY', 'QUOTE_EXPIRED', 'QUOTING_UNAVAILABLE']);

export class IntentsError extends Error {
  constructor(code, message, details = {}) {
    if (!Object.hasOwn(ERROR_CODES, code)) throw new TypeError(`Unknown Intents error code ${code}`);
    super(message);
    this.name = 'IntentsError';
    this.code = code;
    this.retryable = RETRYABLE.has(code);
    this.details = Object.freeze({ ...details });
  }
}

// Provider messages are untrusted text: bound their length and strip control characters before surfacing them.
export function sanitizeProviderMessage(value) {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  return cleaned ? cleaned.slice(0, 200) : null;
}

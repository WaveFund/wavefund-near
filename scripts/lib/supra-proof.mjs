// Supra REST examples return bare hexadecimal; viem requires an 0x prefix.
// Transport normalization does not authenticate a price: the onchain verifier does.
export function supraProofBytes(response) {
  const value = response?.proof_bytes;
  if (typeof value !== 'string' || value.length > 1000000 || !/^(?:0x)?(?:[0-9a-fA-F]{2})+$/.test(value)) {
    throw new Error('Malformed Supra proof bytes');
  }
  return value.startsWith('0x') ? value : `0x${value}`;
}

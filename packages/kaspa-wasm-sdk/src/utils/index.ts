import * as kaspa from '../../wasm/kaspa';

/**
 * Initialize WASM for Node.js environment
 */
export function initializeWASM(): void {
  // Set WebSocket polyfill for Node.js
  if (typeof (globalThis as any).WebSocket === 'undefined') {
    // @ts-ignore
    (globalThis as any).WebSocket = require('websocket').w3cwebsocket;
  }
  
  // Set default log level
  kaspa.setLogLevel('info');
  
  // Initialize panic hook for better error messages
  kaspa.initConsolePanicHook();
}

/**
 * Convert Kaspa to Sompi (smallest unit)
 * 1 KAS = 100,000,000 sompi
 */
export function kasToSompi(kas: number | string): bigint {
  // Normalize the input to a string
  let kasStr = typeof kas === 'number' ? kas.toString() : kas.trim();
  
  // Validate the input is a valid number
  const kasNum = parseFloat(kasStr);
  if (isNaN(kasNum) || kasNum < 0) {
    throw new Error(`Invalid KAS amount: ${kas}. Must be a valid positive number.`);
  }
  
  // Ensure we have a decimal format for the WASM function
  // The WASM kaspaToSompi expects a decimal string format
  if (!kasStr.includes('.')) {
    kasStr = kasStr + '.0';
  }
  
  const result = kaspa.kaspaToSompi(kasStr);
  if (result === null || result === undefined) {
    throw new Error(`Failed to convert KAS to sompi: ${kasStr}. WASM conversion returned null.`);
  }
  return result;
}

/**
 * Convert Sompi to Kaspa string
 */
export function sompiToKas(sompi: bigint | number): string {
  return kaspa.sompiToKaspaString(sompi);
}

/**
 * Convert Sompi to Kaspa string with network suffix
 */
export function sompiToKasWithSuffix(sompi: bigint | number, network: string): string {
  return kaspa.sompiToKaspaStringWithSuffix(sompi, network);
}

/**
 * Validate Kaspa address
 */
export function validateAddress(address: string, network?: string): boolean {
  try {
    const addr = new kaspa.Address(address);
    if (network) {
      const prefix = addr.prefix;
      const expectedPrefix = getAddressPrefix(network);
      return prefix === expectedPrefix;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Get address prefix for network
 */
export function getAddressPrefix(network: string): string {
  switch (network) {
    case 'mainnet':
      return 'kaspa';
    case 'testnet-10':
      return 'kaspatest';
    case 'devnet':
      return 'kaspadev';
    case 'simnet':
      return 'kaspasim';
    default:
      return 'kaspa';
  }
}

/**
 * Generate random mnemonic
 */
export function generateMnemonic(wordCount: number = 12): string {
  const mnemonic = kaspa.Mnemonic.random(wordCount);
  const phrase = mnemonic.phrase;
  mnemonic.free();
  return phrase;
}

/**
 * Validate mnemonic phrase
 */
export function validateMnemonic(phrase: string): boolean {
  return kaspa.Mnemonic.validate(phrase);
}

/**
 * Convert hex string to Uint8Array
 */
export function hexToBytes(hex: string): Uint8Array {
  if (hex.startsWith('0x')) {
    hex = hex.slice(2);
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Convert Uint8Array to hex string
 */
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}
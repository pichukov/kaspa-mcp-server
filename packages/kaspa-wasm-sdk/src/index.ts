// Main SDK export
export { KaspaSDK } from './KaspaSDK';

// Wallet exports
export { KaspaWallet } from './wallet/KaspaWallet';

// Transaction exports
export { TransactionBuilder } from './transaction/TransactionBuilder';

// Network exports
export { RpcClient } from './network/RpcClient';

// UTXO exports
export { UtxoManager } from './utxo/UtxoManager';

// Utility exports
export * from './utils';

// Configuration exports
export * from './config';

// Type exports
export * from './types';

// Re-export necessary WASM types
export * as kaspa from '../wasm/kaspa';
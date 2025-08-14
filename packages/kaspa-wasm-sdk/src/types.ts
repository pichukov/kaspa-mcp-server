import * as kaspa from '../wasm/kaspa';

export type NetworkType = 'mainnet' | 'testnet-10' | 'devnet' | 'simnet';

export interface WalletConfig {
  mnemonic?: string;
  privateKey?: string;
  password?: string;
  accountIndex?: number;
  networkType: NetworkType;
}

export interface TransactionConfig {
  from: string | kaspa.PrivateKey;
  to: string | kaspa.Address;
  amount: bigint;
  fee?: bigint;
  priorityFee?: bigint;
  customTotalFee?: bigint; // If specified, this will be used as the total fee (base + priority)
  payload?: string | Uint8Array;
  changeAddress?: string | kaspa.Address;
}

export interface UTXOInfo {
  address: string;
  outpoint: {
    transactionId: string;
    index: number;
  };
  amount: bigint;
  scriptPublicKey: kaspa.IScriptPublicKey;
  blockDaaScore: bigint;
  isCoinbase: boolean;
}

export interface BalanceInfo {
  address: string;
  balance: bigint;
  pendingBalance?: bigint;
  utxoCount: number;
}

export interface FeeEstimate {
  baseFee: bigint;
  massLimit: bigint;
  estimatedMass: bigint;
  totalFee: bigint;
}

export interface SendTransactionResult {
  transactionId: string;
  fee: bigint;
  mass: bigint;
  changeAmount?: bigint;
}
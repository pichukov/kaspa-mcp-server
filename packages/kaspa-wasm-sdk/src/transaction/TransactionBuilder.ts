import * as kaspa from '../../wasm/kaspa';
import { TransactionConfig, FeeEstimate, SendTransactionResult, NetworkType } from '../types';
import { bytesToHex, hexToBytes } from '../utils';
import { getWasmNetworkType, getWasmNetworkId } from '../utils/network';

export class TransactionBuilder {
  private networkId: string;
  private wasmNetworkType: kaspa.NetworkType;
  private wasmNetworkId: string;

  constructor(networkId: string) {
    this.networkId = networkId;
    this.wasmNetworkType = getWasmNetworkType(networkId as NetworkType);
    this.wasmNetworkId = getWasmNetworkId(networkId as NetworkType);
  }

  /**
   * Convert string to hex format for WASM payload
   */
  private stringToHex(text: string): string {
    return Array.from(new TextEncoder().encode(text))
      .map(byte => byte.toString(16).padStart(2, '0'))
      .join('');
  }

  /**
   * Build a simple transaction
   */
  async buildTransaction(
    utxos: kaspa.IUtxoEntry[],
    outputs: kaspa.IPaymentOutput[],
    changeAddress: string,
    priorityFee: bigint = BigInt(0),
    payload?: string | Uint8Array
  ): Promise<kaspa.Transaction> {
    // Convert payload if provided
    let payloadBytes: Uint8Array | undefined;
    if (payload) {
      payloadBytes = typeof payload === 'string' 
        ? new TextEncoder().encode(payload)
        : payload;
    }

    // Create basic transaction
    const transaction = kaspa.createTransaction(
      utxos,
      outputs,
      priorityFee,
      payloadBytes
    );

    return transaction;
  }

  /**
   * Build transaction using Generator (recommended for automatic UTXO selection)
   */
  async buildWithGenerator(
    utxos: kaspa.IUtxoEntry[],
    outputs: kaspa.IPaymentOutput[],
    changeAddress: string,
    priorityFee: bigint = BigInt(0),
    payload?: string | Uint8Array
  ): Promise<kaspa.PendingTransaction[]> {
    const settings: kaspa.IGeneratorSettingsObject = {
      entries: utxos,
      outputs,
      changeAddress,
      priorityFee,
      payload: payload ? (typeof payload === 'string' ? bytesToHex(new TextEncoder().encode(payload)) : bytesToHex(payload)) : undefined,
      networkId: this.wasmNetworkId
    };

    // Create transactions (may split into multiple if needed)
    try {
      const result = await kaspa.createTransactions(settings);
      return result.transactions;
    } catch (error) {
      // Re-throw with more context
      if (typeof error === 'string') {
        throw new Error(`Transaction creation failed: ${error}`);
      }
      throw error;
    }
  }

  /**
   * Estimate transaction fees
   */
  async estimateFee(
    utxos: kaspa.IUtxoEntry[],
    outputs: kaspa.IPaymentOutput[],
    changeAddress: string,
    priorityFee: bigint = BigInt(0)
  ): Promise<FeeEstimate> {
    const settings: kaspa.IGeneratorSettingsObject = {
      entries: utxos,
      outputs,
      changeAddress,
      priorityFee,
      networkId: this.wasmNetworkId
    };

    const estimate = await kaspa.estimateTransactions(settings);
    
    return {
      baseFee: estimate.fees,
      massLimit: kaspa.maximumStandardTransactionMass(),
      estimatedMass: BigInt(0), // Mass not available in estimate
      totalFee: estimate.fees + priorityFee
    };
  }

  /**
   * Calculate transaction fee for existing transaction
   */
  calculateFee(transaction: kaspa.Transaction | kaspa.ITransaction): bigint {
    const fee = kaspa.calculateTransactionFee(this.networkId, transaction);
    if (!fee) {
      throw new Error('Unable to calculate fee - transaction may exceed mass limit');
    }
    return fee;
  }

  /**
   * Calculate transaction mass
   */
  calculateMass(transaction: kaspa.Transaction | kaspa.ITransaction): bigint {
    return kaspa.calculateTransactionMass(this.wasmNetworkId, transaction);
  }

  /**
   * Sign transaction with private keys
   */
  signTransaction(
    transaction: kaspa.Transaction,
    privateKeys: kaspa.PrivateKey[],
    verifySignatures: boolean = true
  ): kaspa.Transaction {
    return kaspa.signTransaction(transaction, privateKeys, verifySignatures);
  }

  /**
   * Sign pending transaction
   */
  signPendingTransaction(
    pendingTx: kaspa.PendingTransaction,
    privateKeys: kaspa.PrivateKey[],
    verifySignatures: boolean = true
  ): void {
    pendingTx.sign(privateKeys, verifySignatures);
  }

  /**
   * Create compound transaction to consolidate UTXOs
   */
  async createCompoundTransaction(
    utxos: kaspa.IUtxoEntry[],
    targetAddress: string,
    maxUtxosPerTx: number = 100
  ): Promise<kaspa.PendingTransaction[]> {
    const chunks: kaspa.IUtxoEntry[][] = [];
    
    // Split UTXOs into chunks
    for (let i = 0; i < utxos.length; i += maxUtxosPerTx) {
      chunks.push(utxos.slice(i, i + maxUtxosPerTx));
    }

    const transactions: kaspa.PendingTransaction[] = [];
    
    for (const chunk of chunks) {
      const settings: kaspa.IGeneratorSettingsObject = {
        entries: chunk,
        outputs: [], // All funds go to change address
        changeAddress: targetAddress,
        priorityFee: BigInt(0),
        networkId: this.wasmNetworkId
      };

      const result = await kaspa.createTransactions(settings);
      transactions.push(...result.transactions);
    }

    return transactions;
  }

  /**
   * Create transaction with custom script
   */
  createScriptTransaction(
    utxos: kaspa.IUtxoEntry[],
    scriptPubKey: kaspa.ScriptPublicKey,
    amount: bigint,
    changeAddress: string,
    priorityFee: bigint = BigInt(0)
  ): kaspa.Transaction {
    const paymentOutput: kaspa.IPaymentOutput = {
      address: changeAddress, // This will be replaced by the actual recipient
      amount: amount
    };

    return kaspa.createTransaction(
      utxos,
      [paymentOutput],
      priorityFee,
      undefined // payload
    );
  }

  /**
   * Submit transaction to network
   */
  async submitTransaction(
    transaction: kaspa.Transaction | kaspa.PendingTransaction,
    rpcClient: kaspa.RpcClient
  ): Promise<SendTransactionResult> {
    let txId: string;
    let fee: bigint;
    let mass: bigint;
    let changeAmount: bigint | undefined;

    if (transaction instanceof kaspa.PendingTransaction) {
      // Submit pending transaction
      txId = await transaction.submit(rpcClient);
      fee = transaction.feeAmount;
      mass = transaction.mass;
      changeAmount = transaction.changeAmount;
    } else {
      // Submit regular transaction
      const response = await rpcClient.submitTransaction({
        transaction,
        allowOrphan: false
      });
      txId = response.transactionId;
      fee = this.calculateFee(transaction);
      mass = this.calculateMass(transaction);
    }

    return {
      transactionId: txId,
      fee,
      mass,
      changeAmount
    };
  }

  /**
   * Serialize transaction to JSON
   */
  serializeToJSON(transaction: kaspa.Transaction | kaspa.PendingTransaction): string {
    if (transaction instanceof kaspa.PendingTransaction) {
      return transaction.serializeToJSON();
    }
    return transaction.serializeToJSON();
  }

  /**
   * Deserialize transaction from JSON
   */
  deserializeFromJSON(json: string): kaspa.Transaction {
    return kaspa.Transaction.deserializeFromJSON(json);
  }

  /**
   * Create pay-to-address script
   */
  createPayToAddressScript(address: string | kaspa.Address): kaspa.ScriptPublicKey {
    const addr = typeof address === 'string' ? new kaspa.Address(address) : address;
    return kaspa.payToAddressScript(addr);
  }

  /**
   * Create pay-to-script-hash script
   */
  createP2SHScript(redeemScript: Uint8Array): kaspa.ScriptPublicKey {
    return kaspa.payToScriptHashScript(redeemScript);
  }
}
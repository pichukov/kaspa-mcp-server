import * as kaspa from '../../wasm/kaspa';
import { UTXOInfo } from '../types';

export class UtxoManager {
  private processor?: kaspa.UtxoProcessor;
  private context?: kaspa.UtxoContext;
  private trackedAddresses: Set<string> = new Set();
  private eventHandlers: Map<string, Set<Function>> = new Map();
  private networkId: string;

  constructor(networkId: string) {
    this.networkId = networkId;
  }

  /**
   * Initialize UTXO processor and context
   */
  async initialize(rpcClient: kaspa.RpcClient): Promise<void> {
    // Create UTXO processor
    this.processor = new kaspa.UtxoProcessor({
      rpc: rpcClient,
      networkId: this.networkId
    });

    // Set up event listeners
    this.processor.addEventListener('maturity', (event: any) => {
      this.handleMaturityEvent(event);
    });

    this.processor.addEventListener('discovery', (event: any) => {
      this.handleDiscoveryEvent(event);
    });

    this.processor.addEventListener('balance', (event: any) => {
      this.handleBalanceEvent(event);
    });

    this.processor.addEventListener('error', (event: any) => {
      this.handleErrorEvent(event);
    });

    // Start processor
    await this.processor.start();

    // Create UTXO context
    this.context = new kaspa.UtxoContext({
      processor: this.processor
    });
  }

  /**
   * Track addresses for UTXO changes
   */
  async trackAddresses(addresses: string[]): Promise<void> {
    if (!this.context) {
      throw new Error('UTXO manager not initialized');
    }

    const addressObjects = addresses.map(addr => new kaspa.Address(addr));
    await this.context.trackAddresses(addressObjects);
    
    addresses.forEach(addr => this.trackedAddresses.add(addr));
  }

  /**
   * Stop tracking addresses
   */
  async untrackAddresses(addresses: string[]): Promise<void> {
    if (!this.context) {
      throw new Error('UTXO manager not initialized');
    }

    const addressObjects = addresses.map(addr => new kaspa.Address(addr));
    await this.context.unregisterAddresses(addressObjects);
    
    addresses.forEach(addr => this.trackedAddresses.delete(addr));
  }

  /**
   * Get current balance
   */
  getBalance(): { mature: bigint; pending: bigint; outgoing: bigint } | null {
    if (!this.context) {
      return null;
    }

    const balance = this.context.balance;
    if (!balance) {
      return null;
    }
    
    return {
      mature: balance.mature,
      pending: balance.pending,
      outgoing: balance.outgoing
    };
  }

  /**
   * Get mature UTXOs
   */
  getMatureUTXOs(): kaspa.UtxoEntryReference[] {
    if (!this.context) {
      throw new Error('UTXO manager not initialized');
    }

    const length = this.context.matureLength;
    return this.context.getMatureRange(0, length);
  }

  /**
   * Get pending UTXOs
   */
  getPendingUTXOs(): kaspa.UtxoEntryReference[] {
    if (!this.context) {
      throw new Error('UTXO manager not initialized');
    }

    return this.context.getPending();
  }

  /**
   * Get all UTXOs (mature + pending)
   */
  getAllUTXOs(): kaspa.UtxoEntryReference[] {
    const mature = this.getMatureUTXOs();
    const pending = this.getPendingUTXOs();
    return [...mature, ...pending];
  }

  /**
   * Clear all UTXOs from context
   */
  async clear(): Promise<void> {
    if (!this.context) {
      throw new Error('UTXO manager not initialized');
    }

    await this.context.clear();
  }

  /**
   * Refresh UTXO data
   */
  async refresh(): Promise<void> {
    if (!this.context) {
      throw new Error('UTXO manager not initialized');
    }

    // Clear and re-track addresses to refresh
    const addresses = Array.from(this.trackedAddresses);
    if (addresses.length > 0) {
      await this.untrackAddresses(addresses);
      await this.trackAddresses(addresses);
    }
  }

  /**
   * Get UTXO entries for specific addresses
   */
  getUTXOsForAddresses(addresses: string[]): Map<string, kaspa.UtxoEntryReference[]> {
    const allUtxos = this.getAllUTXOs();
    const utxoMap = new Map<string, kaspa.UtxoEntryReference[]>();

    for (const address of addresses) {
      utxoMap.set(address, []);
    }

    for (const utxo of allUtxos) {
      const addr = utxo.address?.toString();
      if (addr && utxoMap.has(addr)) {
        utxoMap.get(addr)!.push(utxo);
      }
    }

    return utxoMap;
  }

  /**
   * Select UTXOs for spending
   * Uses a simple greedy algorithm to select UTXOs
   */
  selectUTXOs(
    availableUtxos: kaspa.IUtxoEntry[],
    targetAmount: bigint,
    feePerUtxo: bigint = BigInt(1000)
  ): { selectedUtxos: kaspa.IUtxoEntry[]; totalAmount: bigint; change: bigint } {
    // Sort UTXOs by amount (largest first)
    const sortedUtxos = [...availableUtxos].sort((a, b) => 
      Number(b.amount - a.amount)
    );

    const selectedUtxos: kaspa.IUtxoEntry[] = [];
    let totalAmount = BigInt(0);
    let totalNeeded = targetAmount;

    for (const utxo of sortedUtxos) {
      selectedUtxos.push(utxo);
      totalAmount += utxo.amount;
      totalNeeded += feePerUtxo; // Add fee for each UTXO

      if (totalAmount >= totalNeeded) {
        break;
      }
    }

    if (totalAmount < totalNeeded) {
      throw new Error(`Insufficient funds. Need ${totalNeeded}, have ${totalAmount}`);
    }

    return {
      selectedUtxos,
      totalAmount,
      change: totalAmount - totalNeeded
    };
  }

  /**
   * Add event listener
   */
  addEventListener(event: 'maturity' | 'discovery' | 'balance' | 'error', handler: Function): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)!.add(handler);
  }

  /**
   * Remove event listener
   */
  removeEventListener(event: string, handler: Function): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.delete(handler);
    }
  }

  /**
   * Handle maturity event
   */
  private handleMaturityEvent(event: any): void {
    const handlers = this.eventHandlers.get('maturity');
    if (handlers) {
      handlers.forEach(handler => handler(event.data));
    }
  }

  /**
   * Handle discovery event
   */
  private handleDiscoveryEvent(event: any): void {
    const handlers = this.eventHandlers.get('discovery');
    if (handlers) {
      handlers.forEach(handler => handler(event.data));
    }
  }

  /**
   * Handle balance event
   */
  private handleBalanceEvent(event: any): void {
    const handlers = this.eventHandlers.get('balance');
    if (handlers) {
      handlers.forEach(handler => handler(event.data));
    }
  }

  /**
   * Handle error event
   */
  private handleErrorEvent(event: any): void {
    const handlers = this.eventHandlers.get('error');
    if (handlers) {
      handlers.forEach(handler => handler(event.data));
    }
  }

  /**
   * Stop UTXO processor
   */
  async stop(): Promise<void> {
    if (this.processor) {
      await this.processor.stop();
    }
  }

  /**
   * Clean up resources
   */
  async dispose(): Promise<void> {
    await this.stop();
    this.context?.free();
    this.processor?.free();
    this.trackedAddresses.clear();
    this.eventHandlers.clear();
  }
}
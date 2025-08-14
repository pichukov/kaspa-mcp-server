import * as kaspa from '../../wasm/kaspa';
import { NetworkType, BalanceInfo, UTXOInfo } from '../types';
import { Configuration } from '../config';
import { getWasmNetworkType, getWasmNetworkId } from '../utils/network';

export class RpcClient {
  private client: kaspa.RpcClient;
  private networkId: string;
  private wasmNetworkType: kaspa.NetworkType;
  private isConnected: boolean = false;
  private eventHandlers: Map<string, Set<Function>> = new Map();

  constructor(networkType: NetworkType, url?: string) {
    this.networkId = networkType;
    this.wasmNetworkType = getWasmNetworkType(networkType);
    
    // Get configuration for the network
    const networkConfig = Configuration.getNetworkConfig(networkType);
    
    // Use proper WASM network ID format
    const wasmNetworkId = getWasmNetworkId(networkType);
    
    this.client = new kaspa.RpcClient({
      url: url || networkConfig.rpcUrl,
      networkId: wasmNetworkId,
      encoding: networkConfig.encoding || kaspa.Encoding.Borsh
    });

    // Set up internal event handling
    this.client.addEventListener((event: any) => {
      this.handleEvent(event);
    });
  }


  /**
   * Connect to RPC server
   */
  async connect(): Promise<void> {
    await this.client.connect();
    this.isConnected = true;

    // Check if node is synced
    const serverInfo = await this.client.getServerInfo();
    if (!serverInfo.isSynced) {
      console.warn('Warning: Node is not fully synced');
    }
  }

  /**
   * Disconnect from RPC server
   */
  async disconnect(): Promise<void> {
    if (this.isConnected) {
      await this.client.disconnect();
      this.isConnected = false;
    }
  }

  /**
   * Check connection status
   */
  getConnectionStatus(): boolean {
    return this.isConnected;
  }

  /**
   * Get server info
   */
  async getServerInfo(): Promise<kaspa.IGetServerInfoResponse> {
    return this.client.getServerInfo();
  }

  /**
   * Get node info
   */
  async getNodeInfo(): Promise<kaspa.IGetInfoResponse> {
    return this.client.getInfo();
  }

  /**
   * Get balance for single address
   */
  async getBalance(address: string): Promise<BalanceInfo> {
    const response = await this.client.getBalanceByAddress({ address });
    
    const utxosResponse = await this.client.getUtxosByAddresses([address]);
    
    return {
      address,
      balance: response.balance,
      utxoCount: utxosResponse.entries.length
    };
  }

  /**
   * Get balances for multiple addresses
   */
  async getBalances(addresses: string[]): Promise<BalanceInfo[]> {
    const response = await this.client.getBalancesByAddresses(addresses);
    const utxosResponse = await this.client.getUtxosByAddresses(addresses);
    
    const utxoCountMap = new Map<string, number>();
    for (const utxo of utxosResponse.entries) {
      const addr = utxo.address?.toString() || '';
      utxoCountMap.set(addr, (utxoCountMap.get(addr) || 0) + 1);
    }
    
    return response.entries.map(entry => ({
      address: entry.address.toString(),
      balance: entry.balance,
      utxoCount: utxoCountMap.get(entry.address.toString()) || 0
    }));
  }

  /**
   * Get UTXOs for addresses
   */
  async getUTXOs(addresses: string[]): Promise<kaspa.IUtxoEntry[]> {
    const response = await this.client.getUtxosByAddresses(addresses);
    
    // Return UTXOs as-is - the WASM expects Address objects, not strings
    return response.entries;
  }

  /**
   * Get block DAG info
   */
  async getBlockDagInfo(): Promise<kaspa.IGetBlockDagInfoResponse> {
    return this.client.getBlockDagInfo();
  }

  /**
   * Get block by hash
   */
  async getBlock(hash: string, includeTransactions: boolean = false): Promise<kaspa.IGetBlockResponse> {
    return this.client.getBlock({
      hash,
      includeTransactions
    });
  }

  /**
   * Get transaction from mempool
   */
  async getMempoolEntry(txId: string): Promise<kaspa.IGetMempoolEntryResponse> {
    return this.client.getMempoolEntry({
      transactionId: txId,
      includeOrphanPool: true,
      filterTransactionPool: false
    });
  }

  /**
   * Submit transaction
   */
  async submitTransaction(transaction: kaspa.Transaction): Promise<string> {
    const response = await this.client.submitTransaction({
      transaction,
      allowOrphan: false
    });
    return response.transactionId;
  }

  /**
   * Subscribe to UTXO changes for addresses
   */
  async subscribeToUTXOs(addresses: string[]): Promise<void> {
    const addressObjects = addresses.map(addr => new kaspa.Address(addr));
    await this.client.subscribeUtxosChanged(addressObjects);
  }

  /**
   * Unsubscribe from UTXO changes
   */
  async unsubscribeFromUTXOs(addresses: string[]): Promise<void> {
    const addressObjects = addresses.map(addr => new kaspa.Address(addr));
    await this.client.unsubscribeUtxosChanged(addressObjects);
  }

  /**
   * Subscribe to virtual chain changes
   */
  async subscribeToChainChanges(includeAcceptedTransactionIds: boolean = false): Promise<void> {
    await this.client.subscribeVirtualChainChanged(includeAcceptedTransactionIds);
  }

  /**
   * Unsubscribe from virtual chain changes
   */
  async unsubscribeFromChainChanges(includeAcceptedTransactionIds: boolean = false): Promise<void> {
    await this.client.unsubscribeVirtualChainChanged(includeAcceptedTransactionIds);
  }

  /**
   * Subscribe to block added events
   */
  async subscribeToBlocks(): Promise<void> {
    await this.client.subscribeBlockAdded();
  }

  /**
   * Unsubscribe from block added events
   */
  async unsubscribeFromBlocks(): Promise<void> {
    await this.client.unsubscribeBlockAdded();
  }

  /**
   * Get fee estimate
   */
  async getFeeEstimate(): Promise<kaspa.IGetFeeEstimateResponse> {
    return this.client.getFeeEstimate();
  }

  /**
   * Get current network
   */
  async getCurrentNetwork(): Promise<string> {
    const response = await this.client.getCurrentNetwork();
    return response.network;
  }

  /**
   * Add event listener
   */
  addEventListener(event: string, handler: Function): void {
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
   * Handle internal events
   */
  private handleEvent(event: any): void {
    const handlers = this.eventHandlers.get(event.type);
    if (handlers) {
      handlers.forEach(handler => handler(event.data));
    }

    // Also emit generic event
    const allHandlers = this.eventHandlers.get('*');
    if (allHandlers) {
      allHandlers.forEach(handler => handler(event));
    }
  }

  /**
   * Get internal RPC client
   */
  getInternalClient(): kaspa.RpcClient {
    return this.client;
  }

  /**
   * Get WASM network type
   */
  getWasmNetworkType(): kaspa.NetworkType {
    return this.wasmNetworkType;
  }

  /**
   * Clean up resources
   */
  async dispose(): Promise<void> {
    await this.disconnect();
    this.client.free();
  }
}
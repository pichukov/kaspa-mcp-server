import * as kaspa from '../wasm/kaspa';
import { KaspaWallet } from './wallet/KaspaWallet';
import { TransactionBuilder } from './transaction/TransactionBuilder';
import { RpcClient } from './network/RpcClient';
import { UtxoManager } from './utxo/UtxoManager';
import { 
  NetworkType, 
  WalletConfig, 
  TransactionConfig, 
  SendTransactionResult,
  BalanceInfo,
  FeeEstimate 
} from './types';
import { 
  initializeWASM, 
  kasToSompi, 
  sompiToKas,
  validateAddress,
  generateMnemonic,
  validateMnemonic 
} from './utils';
import { Configuration, SDKConfig } from './config';

export class KaspaSDK {
  private networkType: NetworkType;
  private rpcClient?: RpcClient;
  private wallet?: KaspaWallet;
  private transactionBuilder: TransactionBuilder;
  private utxoManager: UtxoManager;
  private initialized: boolean = false;
  private utxoProcessor?: kaspa.UtxoProcessor;
  private utxoContext?: kaspa.UtxoContext;
  private eventListeners: Map<string, Set<Function>> = new Map();

  constructor(networkType?: NetworkType, config?: Partial<SDKConfig>) {
    // Apply configuration if provided
    if (config) {
      Configuration.setConfig(config);
    }

    // Use provided network type or get from configuration
    this.networkType = networkType || Configuration.getDefaultNetwork();
    this.transactionBuilder = new TransactionBuilder(this.networkType);
    this.utxoManager = new UtxoManager(this.networkType);
    
    // Initialize WASM
    initializeWASM();
  }

  /**
   * Initialize SDK with RPC connection
   */
  async initialize(rpcUrl?: string): Promise<void> {
    if (this.initialized) {
      return;
    }

    // Connect RPC client
    this.rpcClient = new RpcClient(this.networkType, rpcUrl);
    await this.rpcClient.connect();

    // Initialize UTXO manager
    await this.utxoManager.initialize(this.rpcClient.getInternalClient());

    // Initialize UTXO processor for monitoring
    this.utxoProcessor = new kaspa.UtxoProcessor({
      rpc: this.rpcClient.getInternalClient(),
      networkId: this.networkType,
    });
    await this.utxoProcessor.start();

    this.utxoContext = new kaspa.UtxoContext({ 
      processor: this.utxoProcessor 
    });

    // Set up UTXO processor event listeners
    this.setupUtxoProcessorEvents();

    this.initialized = true;
  }

  /**
   * Set up UTXO processor event listeners
   */
  private setupUtxoProcessorEvents(): void {
    if (!this.utxoProcessor) return;

    // Listen for maturity events (confirmed transactions)
    this.utxoProcessor.addEventListener('maturity', (event: any) => {
      this.emit('transaction:confirmed', event.data);
    });

    // Listen for discovery events (new UTXOs)
    this.utxoProcessor.addEventListener('discovery', (event: any) => {
      this.emit('utxo:discovered', event.data);
    });

    // Listen for pending events
    this.utxoProcessor.addEventListener('pending', (event: any) => {
      this.emit('transaction:pending', event.data);
    });

    // Listen for reorg events
    this.utxoProcessor.addEventListener('reorg', (event: any) => {
      this.emit('chain:reorg', event.data);
    });

    // Listen for stasis events (balance changes)
    this.utxoProcessor.addEventListener('stasis', (event: any) => {
      this.emit('balance:changed', event.data);
    });
  }

  /**
   * Subscribe to incoming transactions for specific addresses
   */
  async subscribeToAddresses(addresses: string[]): Promise<void> {
    if (!this.rpcClient) {
      throw new Error('SDK not initialized. Call initialize() first.');
    }

    // Subscribe to UTXO changes via RPC
    await this.rpcClient.subscribeToUTXOs(addresses);

    // Track addresses in UTXO context for balance monitoring
    if (this.utxoContext) {
      const addressObjects = addresses.map(addr => new kaspa.Address(addr));
      await this.utxoContext.trackAddresses(addressObjects);
    }

    // Set up RPC event listener for UTXO changes
    this.rpcClient.addEventListener('utxos-changed', (data: any) => {
      // Parse incoming transaction data
      const added = data?.added || [];
      const removed = data?.removed || [];

      for (const utxo of added) {
        const txData = {
          transactionId: utxo.outpoint?.transactionId,
          address: utxo.address?.toString(),
          amount: utxo.amount,
          blockDaaScore: utxo.blockDaaScore,
          isCoinbase: utxo.isCoinbase,
          scriptPublicKey: utxo.scriptPublicKey,
        };
        
        this.emit('transaction:incoming', txData);
      }

      for (const utxo of removed) {
        const txData = {
          transactionId: utxo.outpoint?.transactionId,
          address: utxo.address?.toString(),
          amount: utxo.amount,
        };
        
        this.emit('transaction:spent', txData);
      }
    });

    // Subscribe to generic RPC events
    this.rpcClient.addEventListener('*', (event: any) => {
      if (event.type === 'utxos-changed') {
        this.handleUtxoChangedEvent(event.data);
      } else if (event.type === 'virtual-chain-changed') {
        this.emit('chain:changed', event.data);
      } else if (event.type === 'block-added') {
        this.emit('block:added', event.data);
      }
    });
  }

  /**
   * Handle UTXO changed events
   */
  private handleUtxoChangedEvent(data: any): void {
    const added = data?.added || [];
    const removed = data?.removed || [];

    // Process added UTXOs (incoming transactions)
    for (const utxo of added) {
      const eventData = {
        type: 'incoming',
        transactionId: utxo.outpoint?.transactionId,
        address: utxo.address?.toString(),
        amount: utxo.amount,
        index: utxo.outpoint?.index,
        blockDaaScore: utxo.blockDaaScore,
        isCoinbase: utxo.isCoinbase,
      };
      
      this.emit('transaction', eventData);
    }

    // Process removed UTXOs (spent transactions)
    for (const utxo of removed) {
      const eventData = {
        type: 'spent',
        transactionId: utxo.outpoint?.transactionId,
        address: utxo.address?.toString(),
        amount: utxo.amount,
        index: utxo.outpoint?.index,
      };
      
      this.emit('transaction', eventData);
    }
  }

  /**
   * Unsubscribe from addresses
   */
  async unsubscribeFromAddresses(addresses: string[]): Promise<void> {
    if (!this.rpcClient) {
      throw new Error('SDK not initialized. Call initialize() first.');
    }

    await this.rpcClient.unsubscribeFromUTXOs(addresses);

    // Clear tracking for addresses in UTXO context
    if (this.utxoContext) {
      // Note: WASM SDK doesn't have untrackAddresses, we'll clear and re-track remaining
      // For now, just log a warning
      console.warn('Address untracking not fully implemented - consider recreating UTXO context');
    }
  }

  /**
   * Subscribe to blocks
   */
  async subscribeToBlocks(): Promise<void> {
    if (!this.rpcClient) {
      throw new Error('SDK not initialized. Call initialize() first.');
    }

    await this.rpcClient.subscribeToBlocks();
  }

  /**
   * Subscribe to chain changes
   */
  async subscribeToChainChanges(includeAcceptedTransactionIds: boolean = false): Promise<void> {
    if (!this.rpcClient) {
      throw new Error('SDK not initialized. Call initialize() first.');
    }

    await this.rpcClient.subscribeToChainChanges(includeAcceptedTransactionIds);
  }

  /**
   * Add event listener
   */
  on(event: string, handler: Function): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(handler);
  }

  /**
   * Remove event listener
   */
  off(event: string, handler: Function): void {
    const handlers = this.eventListeners.get(event);
    if (handlers) {
      handlers.delete(handler);
    }
  }

  /**
   * Emit event
   */
  private emit(event: string, data: any): void {
    const handlers = this.eventListeners.get(event);
    if (handlers) {
      handlers.forEach(handler => {
        try {
          handler(data);
        } catch (error) {
          console.error(`Error in event handler for ${event}:`, error);
        }
      });
    }
  }

  /**
   * Get detailed transaction information including sender addresses, amounts, and metadata
   */
  async getTransactionDetails(transactionId: string): Promise<any> {
    if (!this.rpcClient) {
      throw new Error('SDK not initialized. Call initialize() first.');
    }

    try {
      // First try to get from mempool (for recent transactions)
      let transaction;
      let blockHash;
      let confirmations = 0;
      let blockTime;
      
      try {
        const mempoolEntry = await this.rpcClient.getMempoolEntry(transactionId);
        transaction = (mempoolEntry as any).transaction || mempoolEntry;
        confirmations = 0;
      } catch (error) {
        // Not in mempool, search in blocks
        const blockDagInfo = await this.rpcClient.getBlockDagInfo();
        const tipHashes = blockDagInfo.tipHashes;

        // Search recent blocks first
        for (const hash of tipHashes) {
          try {
            const block = await this.rpcClient.getBlock(hash, true);
            const foundTx = block.block.transactions.find((tx: any) => 
              tx.verboseData?.transactionId === transactionId
            );
            
            if (foundTx) {
              transaction = foundTx;
              blockHash = hash;
              blockTime = block.block.header.timestamp;
              // Calculate confirmations based on block depth
              const currentDaaScore = blockDagInfo.virtualDaaScore;
              const txDaaScore = block.block.header.daaScore;
              confirmations = Math.max(0, Number(currentDaaScore - txDaaScore));
              break;
            }
          } catch (blockError: any) {
            console.warn(`Failed to get block ${hash}:`, blockError?.message);
          }
        }
      }

      if (!transaction) {
        throw new Error(`Transaction ${transactionId} not found`);
      }

      // Parse transaction details
      const inputs = [];
      const outputs = [];
      let totalInputAmount = BigInt(0);
      let totalOutputAmount = BigInt(0);
      
      // Parse inputs (sender information)
      if (transaction.inputs) {
        for (const input of transaction.inputs) {
          try {
            // Get the referenced UTXO to find sender address
            const prevTxId = input.previousOutpoint?.transactionId;
            const prevIndex = input.previousOutpoint?.index;
            
            if (prevTxId && prevIndex !== undefined) {
              // Try to get the previous transaction to find sender address
              let senderAddress = null;
              let amount = BigInt(0);
              
              try {
                // Get previous transaction directly to avoid circular reference
                const prevTx = await this.getTransactionFromBlockDirect(prevTxId);
                if (prevTx && prevTx.outputs && prevTx.outputs[prevIndex]) {
                  const prevOutput = prevTx.outputs[prevIndex];
                  if (prevOutput.scriptPublicKey) {
                    try {
                      const addressFromScript = new kaspa.Address(prevOutput.scriptPublicKey);
                      senderAddress = addressFromScript.toString();
                      amount = BigInt(prevOutput.amount || 0);
                    } catch (scriptError) {
                      senderAddress = 'Script';
                    }
                  }
                }
              } catch (error) {
                // Could not get previous transaction, use script public key if available
                if (input.scriptPublicKey) {
                  try {
                    const addressFromScript = new kaspa.Address(input.scriptPublicKey);
                    senderAddress = addressFromScript.toString();
                  } catch (scriptError) {
                    senderAddress = 'Unknown';
                  }
                }
              }

              inputs.push({
                previousTransactionId: prevTxId,
                previousIndex: prevIndex,
                address: senderAddress,
                amount: amount.toString(),
                amountKas: KaspaSDK.sompiToKas(amount),
                scriptSig: input.scriptSig,
                sequence: input.sequence
              });
              
              totalInputAmount += amount;
            }
          } catch (error: any) {
            console.warn('Error parsing input:', error?.message);
          }
        }
      }

      // Parse outputs (recipient information)
      if (transaction.outputs) {
        for (let i = 0; i < transaction.outputs.length; i++) {
          const output = transaction.outputs[i];
          try {
            let address = 'Unknown';
            const amount = BigInt(output.amount || 0);
            
            if (output.scriptPublicKey) {
              try {
                const addressFromScript = new kaspa.Address(output.scriptPublicKey);
                address = addressFromScript.toString();
              } catch (scriptError) {
                address = 'Script';
              }
            }

            outputs.push({
              index: i,
              address: address,
              amount: amount.toString(),
              amountKas: KaspaSDK.sompiToKas(amount),
              scriptPublicKey: output.scriptPublicKey
            });
            
            totalOutputAmount += amount;
          } catch (error: any) {
            console.warn('Error parsing output:', error?.message);
          }
        }
      }

      // Calculate fee
      const fee = totalInputAmount - totalOutputAmount;

      // Extract payload if present
      let payload = null;
      if (transaction.payload && transaction.payload.length > 0) {
        try {
          const decoder = new TextDecoder();
          payload = decoder.decode(new Uint8Array(transaction.payload));
        } catch (error) {
          payload = Array.from(transaction.payload).map((b: any) => b.toString(16).padStart(2, '0')).join(' ');
        }
      }

      // Get transaction mass
      let mass = 0;
      try {
        if (transaction.mass !== undefined) {
          mass = transaction.mass;
        } else {
          // Estimate mass if not available
          mass = Number(this.transactionBuilder.calculateMass(transaction));
        }
      } catch (error) {
        mass = 0;
      }

      return {
        transactionId: transactionId,
        blockHash: blockHash,
        blockTime: blockTime,
        confirmations: confirmations,
        inputs: inputs,
        outputs: outputs,
        totalInputAmount: totalInputAmount.toString(),
        totalOutputAmount: totalOutputAmount.toString(),
        totalInputAmountKas: KaspaSDK.sompiToKas(totalInputAmount),
        totalOutputAmountKas: KaspaSDK.sompiToKas(totalOutputAmount),
        fee: fee.toString(),
        feeKas: KaspaSDK.sompiToKas(fee),
        mass: mass,
        payload: payload,
        lockTime: transaction.lockTime,
        subnetworkId: transaction.subnetworkId,
        gas: transaction.gas,
        payloadHash: transaction.payloadHash,
        rawTransaction: transaction
      };

    } catch (error: any) {
      throw new Error(`Failed to get transaction details: ${error?.message}`);
    }
  }

  /**
   * Get raw transaction from blockchain (helper method)
   */
  private async getTransactionFromBlockDirect(transactionId: string): Promise<any> {
    if (!this.rpcClient) {
      throw new Error('SDK not initialized. Call initialize() first.');
    }

    try {
      // First try mempool
      const mempoolEntry = await this.rpcClient.getMempoolEntry(transactionId);
      return (mempoolEntry as any).transaction || mempoolEntry;
    } catch (error) {
      // Search in recent blocks
      const blockDagInfo = await this.rpcClient.getBlockDagInfo();
      const tipHashes = blockDagInfo.tipHashes;

      for (const blockHash of tipHashes) {
        try {
          const block = await this.rpcClient.getBlock(blockHash, true);
          const transaction = block.block.transactions.find((tx: any) => 
            tx.verboseData?.transactionId === transactionId
          );
          
          if (transaction) {
            return transaction;
          }
        } catch (blockError) {
          // Continue searching other blocks
        }
      }
    }

    return null;
  }

  /**
   * Get transaction details from block (deprecated - use getTransactionDetails)
   */
  async getTransactionFromBlock(transactionId: string): Promise<any> {
    console.warn('getTransactionFromBlock is deprecated. Use getTransactionDetails instead.');
    return this.getTransactionDetails(transactionId);
  }

  /**
   * Create or import wallet
   */
  createWallet(config?: Partial<WalletConfig>): KaspaWallet {
    const walletConfig: WalletConfig = {
      networkType: this.networkType,
      ...config
    };

    this.wallet = new KaspaWallet(walletConfig);
    return this.wallet;
  }

  /**
   * Create wallet from preconfigured credentials (environment variables)
   */
  createPreconfiguredWallet(): KaspaWallet {
    const credentials = Configuration.getWalletCredentials();
    
    if (!credentials || (!credentials.mnemonic && !credentials.privateKey)) {
      throw new Error('No preconfigured wallet credentials found. Set KASPA_WALLET_MNEMONIC or KASPA_WALLET_PRIVATE_KEY environment variables.');
    }
    
    const walletConfig: WalletConfig = {
      networkType: this.networkType,
      mnemonic: credentials.mnemonic,
      privateKey: credentials.privateKey
    };

    this.wallet = new KaspaWallet(walletConfig);
    return this.wallet;
  }

  /**
   * Check if preconfigured wallet credentials are available
   */
  hasPreconfiguredWallet(): boolean {
    const credentials = Configuration.getWalletCredentials();
    return !!(credentials && (credentials.mnemonic || credentials.privateKey));
  }

  /**
   * Get current wallet
   */
  getWallet(): KaspaWallet | undefined {
    return this.wallet;
  }

  /**
   * Generate new mnemonic
   */
  static generateMnemonic(wordCount: number = 12): string {
    return generateMnemonic(wordCount);
  }

  /**
   * Validate mnemonic
   */
  static validateMnemonic(phrase: string): boolean {
    return validateMnemonic(phrase);
  }

  /**
   * Validate address
   */
  static validateAddress(address: string, network?: NetworkType): boolean {
    return validateAddress(address, network);
  }

  /**
   * Convert KAS to Sompi
   */
  static kasToSompi(kas: number | string): bigint {
    return kasToSompi(kas);
  }

  /**
   * Convert Sompi to KAS
   */
  static sompiToKas(sompi: bigint | number): string {
    return sompiToKas(sompi);
  }

  /**
   * Set network RPC URL
   */
  static setNetworkRpcUrl(network: NetworkType, rpcUrl: string, encoding?: kaspa.Encoding): void {
    Configuration.setNetworkRpcUrl(network, rpcUrl, encoding);
  }

  /**
   * Get RPC URL for a network
   */
  static getNetworkRpcUrl(network: NetworkType): string {
    return Configuration.getNetworkRpcUrl(network);
  }

  /**
   * Set default network
   */
  static setDefaultNetwork(network: NetworkType): void {
    Configuration.setDefaultNetwork(network);
  }

  /**
   * Load configuration from environment variables
   */
  static loadConfigFromEnv(): void {
    Configuration.loadFromEnv();
  }

  /**
   * Load configuration from JSON file
   */
  static async loadConfigFromFile(filePath: string): Promise<void> {
    await Configuration.loadFromFile(filePath);
  }

  /**
   * Save current configuration to JSON file
   */
  static async saveConfigToFile(filePath: string): Promise<void> {
    await Configuration.saveToFile(filePath);
  }

  /**
   * Get current configuration
   */
  static getConfig(): SDKConfig {
    return Configuration.getConfig();
  }

  /**
   * Reset configuration to defaults
   */
  static resetConfig(): void {
    Configuration.reset();
  }

  /**
   * Get balance for address
   */
  async getBalance(address: string): Promise<BalanceInfo> {
    if (!this.rpcClient) {
      throw new Error('SDK not initialized. Call initialize() first.');
    }
    return this.rpcClient.getBalance(address);
  }

  /**
   * Get balances for multiple addresses
   */
  async getBalances(addresses: string[]): Promise<BalanceInfo[]> {
    if (!this.rpcClient) {
      throw new Error('SDK not initialized. Call initialize() first.');
    }
    return this.rpcClient.getBalances(addresses);
  }

  /**
   * Send transaction with custom total fee (internal helper)
   */
  private async sendTransactionWithCustomFee(
    config: TransactionConfig, 
    customTotalFee: bigint
  ): Promise<SendTransactionResult> {
    if (!this.rpcClient) {
      throw new Error('SDK not initialized. Call initialize() first.');
    }

    // Get sender private key
    let senderPrivateKey: kaspa.PrivateKey;
    if (typeof config.from === 'string') {
      if (!this.wallet) {
        throw new Error('No wallet available. Create or import a wallet first.');
      }
      senderPrivateKey = this.wallet.getReceivePrivateKey(0);
    } else {
      senderPrivateKey = config.from;
    }

    // Get sender address
    const senderAddress = senderPrivateKey.toAddress(this.networkType).toString();

    // Get UTXOs for sender
    const utxos = await this.rpcClient.getUTXOs([senderAddress]);
    if (utxos.length === 0) {
      throw new Error('No UTXOs available for spending');
    }

    // Prepare recipient and change addresses
    const recipientAddress = typeof config.to === 'string' ? config.to : config.to.toString();
    const changeAddress = config.changeAddress 
      ? (typeof config.changeAddress === 'string' ? config.changeAddress : config.changeAddress.toString())
      : senderAddress;

    // Create payment output
    const outputs: kaspa.IPaymentOutput[] = [{
      address: recipientAddress,
      amount: config.amount
    }];

    // Add payload if provided
    let payload: Uint8Array | undefined;
    if (config.payload) {
      payload = typeof config.payload === 'string' 
        ? new TextEncoder().encode(config.payload) 
        : config.payload;
    }

    // First, estimate what the base fee would be with zero priority fee
    const baseFeeEstimate = await this.estimateFee(senderAddress, recipientAddress, config.amount);
    
    // Calculate the priority fee needed to achieve the custom total fee
    const priorityFee = customTotalFee > baseFeeEstimate.baseFee 
      ? customTotalFee - baseFeeEstimate.baseFee 
      : BigInt(0);

    console.error(`[Debug] Custom fee calculation:`);
    console.error(`[Debug] - Requested total fee: ${KaspaSDK.sompiToKas(customTotalFee)} KAS`);
    console.error(`[Debug] - Estimated base fee: ${KaspaSDK.sompiToKas(baseFeeEstimate.baseFee)} KAS`);
    console.error(`[Debug] - Calculated priority fee: ${KaspaSDK.sompiToKas(priorityFee)} KAS`);

    // Build transaction with calculated priority fee
    const pendingTransactions = await this.transactionBuilder.buildWithGenerator(
      utxos,
      outputs,
      changeAddress,
      priorityFee,
      payload
    );

    if (!pendingTransactions || pendingTransactions.length === 0) {
      throw new Error('Failed to create transaction');
    }

    const pendingTx = pendingTransactions[0];
    
    // Sign and submit transaction
    pendingTx.sign([senderPrivateKey], true);
    const signedTx = pendingTx.transaction;
    const txId = signedTx.id;

    await this.rpcClient.submitTransaction(signedTx);

    // Calculate actual fee from the transaction
    const mass = this.transactionBuilder.calculateMass(signedTx);
    const totalInputAmount = utxos.reduce((sum, utxo) => sum + utxo.amount, BigInt(0));
    const actualOutputAmount = signedTx.outputs.reduce((sum, output) => sum + output.value, BigInt(0));
    const actualFee = totalInputAmount - actualOutputAmount;

    console.error(`[Debug] Transaction with custom fee created:`);
    console.error(`[Debug] - Requested fee: ${KaspaSDK.sompiToKas(customTotalFee)} KAS`);
    console.error(`[Debug] - Actual fee: ${KaspaSDK.sompiToKas(actualFee)} KAS`);
    console.error(`[Debug] - Fee difference: ${KaspaSDK.sompiToKas(actualFee - customTotalFee)} KAS`);

    return {
      transactionId: txId,
      fee: actualFee,
      mass
    };
  }

  /**
   * Send transaction
   */
  async sendTransaction(config: TransactionConfig): Promise<SendTransactionResult> {
    // If customTotalFee is specified, use the specialized method
    if (config.customTotalFee !== undefined) {
      return this.sendTransactionWithCustomFee(config, config.customTotalFee);
    }

    if (!this.rpcClient) {
      throw new Error('SDK not initialized. Call initialize() first.');
    }

    // Get sender private key
    let senderPrivateKey: kaspa.PrivateKey;
    if (typeof config.from === 'string') {
      if (!this.wallet) {
        throw new Error('No wallet available. Create or import a wallet first.');
      }
      // Find the address index (simplified - assumes it's the first address)
      senderPrivateKey = this.wallet.getReceivePrivateKey(0);
    } else {
      senderPrivateKey = config.from;
    }

    // Get sender address
    const senderAddress = senderPrivateKey.toAddress(this.networkType).toString();

    // Get UTXOs for sender
    const utxos = await this.rpcClient.getUTXOs([senderAddress]);
    if (utxos.length === 0) {
      throw new Error('No UTXOs available for spending');
    }

    // Prepare recipient address
    const recipientAddress = typeof config.to === 'string' 
      ? config.to 
      : config.to.toString();

    // Prepare change address
    const changeAddress = config.changeAddress 
      ? (typeof config.changeAddress === 'string' ? config.changeAddress : config.changeAddress.toString())
      : senderAddress;

    // Create payment output
    const outputs: kaspa.IPaymentOutput[] = [{
      address: recipientAddress,
      amount: config.amount
    }];

    // Add payload if provided
    let payload: Uint8Array | undefined;
    if (config.payload) {
      if (typeof config.payload === 'string') {
        const encoder = new TextEncoder();
        payload = encoder.encode(config.payload);
      } else {
        payload = config.payload;
      }
    }

    // Use generator to automatically handle change addresses and fee calculation
    const pendingTransactions = await this.transactionBuilder.buildWithGenerator(
      utxos,
      outputs,
      changeAddress,
      config.priorityFee || BigInt(0),
      payload
    );

    if (!pendingTransactions || pendingTransactions.length === 0) {
      throw new Error('Failed to create transaction');
    }

    const pendingTx = pendingTransactions[0];
    
    // Sign transaction
    pendingTx.sign([senderPrivateKey], true);
    const signedTx = pendingTx.transaction;

    // Get transaction ID
    const txId = signedTx.id;

    // Submit transaction
    await this.rpcClient.submitTransaction(signedTx);

    // Get transaction mass (computational weight)
    const mass = this.transactionBuilder.calculateMass(signedTx);

    // Calculate total fee using actual transaction inputs/outputs (including change)
    const totalInputAmount = utxos.reduce((sum, utxo) => sum + utxo.amount, BigInt(0));
    
    // Get actual output amounts from the signed transaction (includes change outputs)
    const actualOutputAmount = signedTx.outputs.reduce((sum, output) => sum + output.value, BigInt(0));
    const fee = totalInputAmount - actualOutputAmount;
    
    // Debug logging
    console.error(`[Debug] Transaction created:`);
    console.error(`[Debug] - Total inputs: ${KaspaSDK.sompiToKas(totalInputAmount)} KAS`);
    console.error(`[Debug] - Payment amount: ${KaspaSDK.sompiToKas(config.amount)} KAS`);
    console.error(`[Debug] - Total actual outputs: ${KaspaSDK.sompiToKas(actualOutputAmount)} KAS`);
    console.error(`[Debug] - Calculated fee: ${KaspaSDK.sompiToKas(fee)} KAS`);
    console.error(`[Debug] - Transaction outputs count: ${signedTx.outputs.length}`);

    return {
      transactionId: txId,
      fee,
      mass
    };
  }

  /**
   * Estimate transaction fee
   */
  async estimateFee(from: string, to: string, amount: bigint): Promise<FeeEstimate> {
    if (!this.rpcClient) {
      throw new Error('SDK not initialized. Call initialize() first.');
    }

    // Get UTXOs for estimation
    const utxos = await this.rpcClient.getUTXOs([from]);
    if (utxos.length === 0) {
      throw new Error('No UTXOs available for estimation');
    }

    // Get fee estimate from network
    const feeEstimateResponse = await this.rpcClient.getFeeEstimate();
    
    // Extract the feerate from the response
    // Use priority bucket for fastest inclusion, or normal bucket if available
    let feerate: number = 0;
    
    if (feeEstimateResponse?.estimate) {
      const estimate = feeEstimateResponse.estimate;
      
      // Priority bucket for fastest inclusion
      if (estimate.priorityBucket?.feerate) {
        feerate = estimate.priorityBucket.feerate;
      }
      // Fall back to normal bucket
      else if (estimate.normalBuckets && estimate.normalBuckets.length > 0 && estimate.normalBuckets[0]?.feerate) {
        feerate = estimate.normalBuckets[0].feerate;
      }
      // Fall back to low bucket
      else if (estimate.lowBuckets && estimate.lowBuckets.length > 0 && estimate.lowBuckets[0]?.feerate) {
        feerate = estimate.lowBuckets[0].feerate;
      }
    }
    
    // If we still don't have a feerate, use a minimum default
    if (!feerate || feerate === 0) {
      console.warn('No feerate available from network, using default minimum');
      feerate = 1; // 1 sompi per gram minimum
    }
    
    // Create a dummy transaction to estimate mass
    const outputs: kaspa.IPaymentOutput[] = [{
      address: to,
      amount
    }];

    const transaction = await this.transactionBuilder.buildTransaction(
      utxos,
      outputs,
      from,
      BigInt(0),
      undefined
    );

    const mass = this.transactionBuilder.calculateMass(transaction);
    
    // Calculate fee: feerate (sompi/gram) * mass (grams)
    const baseFee = BigInt(Math.ceil(feerate * Number(mass)));

    return {
      baseFee,
      totalFee: baseFee,
      estimatedMass: mass,
      massLimit: BigInt(100000) // Standard mass limit
    };
  }

  /**
   * Get network type
   */
  getNetworkType(): NetworkType {
    return this.networkType;
  }

  /**
   * Dispose SDK resources
   */
  async dispose(): Promise<void> {
    // Clear event listeners
    this.eventListeners.clear();

    // Stop UTXO processor
    if (this.utxoProcessor) {
      await this.utxoProcessor.stop();
      this.utxoProcessor.free();
    }

    // Clear UTXO context
    if (this.utxoContext) {
      this.utxoContext.clear();
      this.utxoContext.free();
    }

    // Disconnect RPC client
    if (this.rpcClient) {
      await this.rpcClient.dispose();
    }

    // Dispose wallet
    if (this.wallet) {
      this.wallet.dispose();
    }

    this.initialized = false;
  }
}
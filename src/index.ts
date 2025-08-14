#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { KaspaSDK, Configuration } from 'kaspa-wasm-sdk';

// Global SDK instance management
const sdkInstances = new Map<string, KaspaSDK>();
const walletInstances = new Map<string, any>();

// Subscription management
interface SubscriptionInfo {
  addresses: Set<string>;
  includeTransactions: boolean;
  lastBalances: Map<string, bigint>;
  eventListener?: Function;
}

const subscriptionInstances = new Map<string, SubscriptionInfo>();

class KaspaMCPServer {
  private server: Server;

  // Session ID normalization helper
  private normalizeSessionId(sessionId?: string): string {
    // Normalize empty string, undefined, or null to 'default'
    return sessionId && sessionId.trim() ? sessionId.trim() : 'default';
  }

  constructor() {
    // Load configuration from environment variables
    Configuration.loadFromEnv();
    
    this.server = new Server(
      {
        name: 'kaspa-server',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupToolHandlers();
    this.setupErrorHandling();
  }

  private setupErrorHandling(): void {
    this.server.onerror = (error) => console.error('[MCP Error]', error);
    process.on('SIGINT', async () => {
      await this.cleanup();
      process.exit(0);
    });
  }

  private async cleanup(): Promise<void> {
    // Clean up all SDK instances
    for (const [sessionId, sdk] of sdkInstances) {
      try {
        await sdk.dispose();
      } catch (error) {
        console.error(`[Warning] Error disposing SDK ${sessionId}:`, error);
        // Continue with cleanup even if disposal fails
      }
    }
    
    // Clean up all wallet instances
    for (const [sessionId, wallet] of walletInstances) {
      try {
        if (wallet && wallet.dispose) {
          wallet.dispose();
        }
      } catch (error) {
        console.error(`[Warning] Error disposing wallet ${sessionId}:`, error);
        // Continue with cleanup even if disposal fails
      }
    }
    
    sdkInstances.clear();
    walletInstances.clear();
  }

  private setupToolHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'kaspa_connect',
          description: 'Connect to Kaspa network (mainnet, testnet-10, devnet, simnet)',
          inputSchema: {
            type: 'object',
            properties: {
              network: {
                type: 'string',
                enum: ['mainnet', 'testnet-10', 'devnet', 'simnet'],
                description: 'Network to connect to',
                default: 'mainnet'
              },
              rpcUrl: {
                type: 'string',
                description: 'Optional custom RPC URL'
              },
              sessionId: {
                type: 'string',
                description: 'Session identifier for managing connections',
                default: 'default'
              }
            },
            required: ['network']
          }
        },
        {
          name: 'kaspa_create_wallet',
          description: 'Create or import a Kaspa wallet',
          inputSchema: {
            type: 'object',
            properties: {
              sessionId: {
                type: 'string',
                description: 'Session identifier',
                default: 'default'
              },
              mnemonic: {
                type: 'string',
                description: 'Optional mnemonic phrase to import existing wallet'
              },
              privateKey: {
                type: 'string',
                description: 'Optional private key to import wallet'
              }
            }
          }
        },
        {
          name: 'kaspa_get_balance',
          description: 'Get balance for a Kaspa address',
          inputSchema: {
            type: 'object',
            properties: {
              address: {
                type: 'string',
                description: 'Kaspa address to check balance'
              },
              sessionId: {
                type: 'string',
                description: 'Session identifier',
                default: 'default'
              }
            },
            required: ['address']
          }
        },
        {
          name: 'kaspa_send_transaction',
          description: 'Send a Kaspa transaction',
          inputSchema: {
            type: 'object',
            properties: {
              sessionId: {
                type: 'string',
                description: 'Session identifier',
                default: 'default'
              },
              from: {
                type: 'string',
                description: 'Sender address (optional - uses wallet\'s first address if not specified)'
              },
              to: {
                type: 'string',
                description: 'Recipient address'
              },
              amount: {
                type: 'string',
                description: 'Amount in KAS (e.g., "1.5", "30", "0.001")'
              },
              feePriority: {
                type: 'string',
                description: 'Fee priority level: "low" (1+ hour), "normal" (1 minute), "high" (immediate)',
                enum: ['low', 'normal', 'high'],
                default: 'normal'
              },
              customFee: {
                type: 'string',
                description: 'Custom fee in KAS (overrides feePriority if specified)'
              },
              priorityFee: {
                type: 'string',
                description: 'Additional priority fee in KAS (deprecated, use customFee)',
                default: '0'
              },
              payload: {
                type: 'string',
                description: 'Optional payload/message to attach'
              }
            },
            required: ['to', 'amount']
          }
        },
        {
          name: 'kaspa_estimate_fee',
          description: 'Estimate transaction fee',
          inputSchema: {
            type: 'object',
            properties: {
              sessionId: {
                type: 'string',
                description: 'Session identifier',
                default: 'default'
              },
              from: {
                type: 'string',
                description: 'Sender address'
              },
              to: {
                type: 'string',
                description: 'Recipient address'  
              },
              amount: {
                type: 'string',
                description: 'Amount in KAS'
              }
            },
            required: ['from', 'to', 'amount']
          }
        },
        {
          name: 'kaspa_get_fee_recommendations',
          description: 'Get fee recommendations for different priority levels',
          inputSchema: {
            type: 'object',
            properties: {
              sessionId: {
                type: 'string',
                description: 'Session identifier',
                default: 'default'
              },
              from: {
                type: 'string',
                description: 'Sender address'
              },
              to: {
                type: 'string',
                description: 'Recipient address'  
              },
              amount: {
                type: 'string',
                description: 'Amount in KAS'
              }
            },
            required: ['from', 'to', 'amount']
          }
        },
        {
          name: 'kaspa_generate_mnemonic',
          description: 'Generate a new mnemonic phrase for wallet creation',
          inputSchema: {
            type: 'object',
            properties: {
              wordCount: {
                type: 'number',
                description: 'Number of words (12, 15, 18, 21, or 24)',
                default: 12
              }
            }
          }
        },
        {
          name: 'kaspa_validate_address',
          description: 'Validate a Kaspa address',
          inputSchema: {
            type: 'object',
            properties: {
              address: {
                type: 'string',
                description: 'Address to validate'
              },
              network: {
                type: 'string',
                description: 'Network type for validation',
                enum: ['mainnet', 'testnet-10', 'devnet', 'simnet']
              }
            },
            required: ['address']
          }
        },
        {
          name: 'kaspa_get_wallet_info',
          description: 'Get wallet information (addresses, balance)',
          inputSchema: {
            type: 'object',
            properties: {
              sessionId: {
                type: 'string',
                description: 'Session identifier',
                default: 'default'
              }
            }
          }
        },
        {
          name: 'kaspa_send_from_wallet',
          description: 'Send Kaspa from your wallet (simplified version)',
          inputSchema: {
            type: 'object',
            properties: {
              sessionId: {
                type: 'string',
                description: 'Session identifier',
                default: 'default'
              },
              to: {
                type: 'string',
                description: 'Recipient address'
              },
              amount: {
                type: 'string',
                description: 'Amount in KAS (e.g., "1.5", "30", "0.001")'
              },
              addressIndex: {
                type: 'number',
                description: 'Wallet address index to send from (default: 0)',
                default: 0
              },
              feePriority: {
                type: 'string',
                description: 'Fee priority level: "low" (1+ hour), "normal" (1 minute), "high" (immediate)',
                enum: ['low', 'normal', 'high'],
                default: 'normal'
              },
              customFee: {
                type: 'string',
                description: 'Custom fee in KAS (overrides feePriority if specified)'
              },
              payload: {
                type: 'string',
                description: 'Optional payload/message to attach to the transaction'
              }
            },
            required: ['to', 'amount']
          }
        },
        {
          name: 'kaspa_subscribe_balance',
          description: 'Subscribe to balance changes for wallet addresses',
          inputSchema: {
            type: 'object',
            properties: {
              sessionId: {
                type: 'string',
                description: 'Session identifier',
                default: 'default'
              },
              addresses: {
                type: 'array',
                items: { type: 'string' },
                description: 'Array of addresses to monitor (optional - uses wallet addresses if not provided)'
              },
              includeTransactions: {
                type: 'boolean',
                description: 'Include transaction details in notifications',
                default: true
              }
            }
          }
        },
        {
          name: 'kaspa_unsubscribe_balance',
          description: 'Unsubscribe from balance change notifications',
          inputSchema: {
            type: 'object',
            properties: {
              sessionId: {
                type: 'string',
                description: 'Session identifier',
                default: 'default'
              },
              addresses: {
                type: 'array',
                items: { type: 'string' },
                description: 'Array of addresses to stop monitoring (optional - stops all if not provided)'
              }
            }
          }
        },
        {
          name: 'kaspa_get_subscription_status',
          description: 'Get current subscription status and monitored addresses',
          inputSchema: {
            type: 'object',
            properties: {
              sessionId: {
                type: 'string',
                description: 'Session identifier',
                default: 'default'
              }
            }
          }
        },
        {
          name: 'kaspa_get_transaction_details',
          description: 'Get detailed information about a transaction including sender addresses, amounts, and metadata',
          inputSchema: {
            type: 'object',
            properties: {
              sessionId: {
                type: 'string',
                description: 'Session identifier',
                default: 'default'
              },
              transactionId: {
                type: 'string',
                description: 'Transaction ID to get details for'
              }
            },
            required: ['transactionId']
          }
        },
        {
          name: 'kaspa_setup_preconfigured_wallet',
          description: 'Setup wallet using preconfigured credentials from environment variables (KASPA_WALLET_MNEMONIC or KASPA_WALLET_PRIVATE_KEY)',
          inputSchema: {
            type: 'object',
            properties: {
              sessionId: {
                type: 'string',
                description: 'Session identifier',
                default: 'default'
              }
            }
          }
        }
      ]
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'kaspa_connect':
            return await this.handleConnect(args);
          case 'kaspa_create_wallet':
            return await this.handleCreateWallet(args);
          case 'kaspa_get_balance':
            return await this.handleGetBalance(args);
          case 'kaspa_send_transaction':
            return await this.handleSendTransaction(args);
          case 'kaspa_estimate_fee':
            return await this.handleEstimateFee(args);
          case 'kaspa_get_fee_recommendations':
            return await this.handleGetFeeRecommendations(args);
          case 'kaspa_generate_mnemonic':
            return await this.handleGenerateMnemonic(args);
          case 'kaspa_validate_address':
            return await this.handleValidateAddress(args);
          case 'kaspa_get_wallet_info':
            return await this.handleGetWalletInfo(args);
          case 'kaspa_send_from_wallet':
            return await this.handleSendFromWallet(args);
          case 'kaspa_subscribe_balance':
            return await this.handleSubscribeBalance(args);
          case 'kaspa_unsubscribe_balance':
            return await this.handleUnsubscribeBalance(args);
          case 'kaspa_get_subscription_status':
            return await this.handleGetSubscriptionStatus(args);
          case 'kaspa_get_transaction_details':
            return await this.handleGetTransactionDetails(args);
          case 'kaspa_setup_preconfigured_wallet':
            return await this.handleSetupPreconfiguredWallet(args);
          default:
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown tool: ${name}`
            );
        }
      } catch (error) {
        if (error instanceof McpError) {
          throw error;
        }
        throw new McpError(
          ErrorCode.InternalError,
          `Tool ${name} failed: ${(error as Error).message}`
        );
      }
    });
  }

  private async handleConnect(args: any) {
    const { network = 'mainnet', rpcUrl, sessionId = 'default' } = args;

    try {
      // Check if we already have a connection to the same network
      const existingSdk = sdkInstances.get(sessionId);
      if (existingSdk && existingSdk.getNetworkType() === network) {
        console.error(`[Info] Already connected to ${network} network for session ${sessionId}`);
        return {
          content: [
            {
              type: 'text',
              text: `Already connected to Kaspa ${network} network`
            }
          ]
        };
      }

      // Store existing wallet info before disposing SDK
      let existingWallet = null;
      if (walletInstances.has(sessionId)) {
        const wallet = walletInstances.get(sessionId);
        try {
          existingWallet = {
            mnemonic: wallet.getMnemonic(),
            // We'll recreate the wallet after connecting to the new network
          };
        } catch (error) {
          console.error(`[Warning] Could not preserve wallet during reconnection:`, error);
        }
      }

      // Dispose existing SDK if exists
      if (existingSdk) {
        console.error(`[Info] Disposing existing SDK for session ${sessionId}`);
        try {
          await existingSdk.dispose();
        } catch (error) {
          console.error(`[Warning] Error disposing SDK: ${(error as Error).message}`);
          // Continue anyway - we'll create a new instance
        }
        sdkInstances.delete(sessionId);
      }

      // Dispose existing wallet since we're changing networks
      if (walletInstances.has(sessionId)) {
        console.error(`[Info] Disposing existing wallet for session ${sessionId}`);
        const wallet = walletInstances.get(sessionId);
        try {
          if (wallet && wallet.dispose) {
            wallet.dispose();
          }
        } catch (error) {
          console.error(`[Warning] Error disposing wallet: ${(error as Error).message}`);
          // Continue anyway
        }
        walletInstances.delete(sessionId);
      }

      console.error(`[Info] Creating new SDK for ${network} network`);
      // Ensure configuration is loaded from environment for this SDK
      Configuration.loadFromEnv();
      const sdk = new KaspaSDK(network);
      await sdk.initialize(rpcUrl);
      
      sdkInstances.set(sessionId, sdk);

      let responseText = `Successfully connected to Kaspa ${network} network${rpcUrl ? ` using custom RPC: ${rpcUrl}` : ''}`;

      // Recreate wallet if we had one before
      if (existingWallet) {
        try {
          console.error(`[Info] Recreating wallet for new network`);
          const newWallet = sdk.createWallet({ mnemonic: existingWallet.mnemonic });
          walletInstances.set(sessionId, newWallet);
          
          const receiveAddress = newWallet.getReceiveAddress(0);
          responseText += `\n\nWallet recreated for new network:\nAddress: ${receiveAddress}`;
        } catch (error) {
          responseText += `\n\nWarning: Could not recreate wallet: ${(error as Error).message}`;
        }
      }

      return {
        content: [
          {
            type: 'text',
            text: responseText
          }
        ]
      };
    } catch (error) {
      console.error(`[Error] Failed to connect to Kaspa network:`, error);
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to connect to Kaspa network: ${(error as Error).message}`
      );
    }
  }

  private async handleCreateWallet(args: any) {
    const rawSessionId = args.sessionId;
    const sessionId = this.normalizeSessionId(rawSessionId);
    const { mnemonic, privateKey } = args;
    
    console.error(`[Debug] handleCreateWallet - raw sessionId: "${rawSessionId}", normalized: "${sessionId}"`);

    let sdk = sdkInstances.get(sessionId);
    if (!sdk) {
      // Auto-connect to testnet-10 if no connection exists
      console.error(`[Info] No SDK connection found, auto-connecting to testnet-10`);
      try {
        await this.handleConnect({ 
          network: 'testnet-10', 
          sessionId 
        });
        sdk = sdkInstances.get(sessionId);
        if (!sdk) {
          throw new Error('Failed to auto-connect');
        }
      } catch (error) {
        throw new McpError(
          ErrorCode.InvalidRequest, 
          'No active connection and failed to auto-connect. Please connect first using kaspa_connect.'
        );
      }
    }

    try {
      console.error(`[Info] Creating wallet for session ${sessionId}`);
      
      // Dispose existing wallet if exists
      if (walletInstances.has(sessionId)) {
        console.error(`[Info] Disposing existing wallet`);
        walletInstances.get(sessionId)!.dispose();
        walletInstances.delete(sessionId);
      }

      const wallet = sdk.createWallet({ mnemonic, privateKey });
      walletInstances.set(sessionId, wallet);
      
      console.error(`[Debug] Wallet created and stored for session: "${sessionId}"`);
      console.error(`[Debug] Current wallet sessions after creation: ${Array.from(walletInstances.keys()).join(', ')}`);

      const receiveAddress = wallet.getReceiveAddress(0);
      const changeAddress = wallet.getChangeAddress(0);

      let responseText = `Wallet created successfully!
Receive Address: ${receiveAddress}
Change Address: ${changeAddress}
${!mnemonic && !privateKey ? `Mnemonic: ${wallet.getMnemonic()}` : 'Wallet imported from provided credentials'}`;

      // Add network info if we auto-connected
      if (!sdkInstances.has(sessionId)) {
        responseText += `\n\nNote: Auto-connected to ${sdk.getNetworkType()} network`;
      }

      return {
        content: [
          {
            type: 'text',
            text: responseText
          }
        ]
      };
    } catch (error) {
      console.error(`[Error] Failed to create wallet:`, error);
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to create wallet: ${(error as Error).message}`
      );
    }
  }

  private async handleGetBalance(args: any) {
    const { address, sessionId = 'default' } = args;

    const sdk = sdkInstances.get(sessionId);
    if (!sdk) {
      throw new McpError(ErrorCode.InvalidRequest, 'No active connection. Please connect first.');
    }

    try {
      const balance = await sdk.getBalance(address);
      
      return {
        content: [
          {
            type: 'text',
            text: `Balance for ${address}:
Amount: ${KaspaSDK.sompiToKas(balance.balance)} KAS
UTXOs: ${balance.utxoCount}
Raw (sompi): ${balance.balance}`
          }
        ]
      };
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to get balance: ${(error as Error).message}`
      );
    }
  }

  private async handleSendTransaction(args: any) {
    const { 
      from, 
      to, 
      amount, 
      feePriority = 'normal',
      customFee,
      priorityFee = '0', // Deprecated, kept for backward compatibility
      payload 
    } = args;

    const sessionId = this.normalizeSessionId(args.sessionId);
    console.error(`[Debug] handleSendTransaction using sessionId: "${sessionId}"`);

    const sdk = sdkInstances.get(sessionId);
    const wallet = walletInstances.get(sessionId);
    
    // Debug: Show all available sessions
    console.error(`[Debug] Available SDK sessions: ${Array.from(sdkInstances.keys()).join(', ')}`);
    console.error(`[Debug] Available wallet sessions: ${Array.from(walletInstances.keys()).join(', ')}`);
    console.error(`[Debug] Looking for session: "${sessionId}"`);
    console.error(`[Debug] SDK found: ${!!sdk}, Wallet found: ${!!wallet}`);
    
    if (!sdk) {
      throw new McpError(ErrorCode.InvalidRequest, 'No active connection. Please connect first.');
    }

    if (!wallet) {
      throw new McpError(ErrorCode.InvalidRequest, 'No wallet available. Please create or import a wallet first.');
    }

    try {
      // Validate and format amounts
      if (!amount || amount === '0') {
        throw new Error('Invalid amount: must be greater than 0');
      }
      
      const amountStr = String(amount).trim();
      
      // Validate amount format (should be a valid number)
      if (isNaN(parseFloat(amountStr))) {
        throw new Error(`Invalid amount format: "${amountStr}". Please provide a numeric value.`);
      }
      
      console.error(`[Debug] Sending transaction: amount=${amountStr}, feePriority=${feePriority}, customFee=${customFee}`);
      
      // Convert amount to sompi
      let amountSompi: bigint;
      try {
        console.error(`[Debug] About to convert amount: "${amountStr}" (type: ${typeof amountStr})`);
        amountSompi = KaspaSDK.kasToSompi(amountStr);
        console.error(`[Debug] Amount conversion successful: ${amountSompi}`);
      } catch (error) {
        console.error(`[Error] Conversion failed for amount="${amountStr}", error:`, error);
        throw new Error(`Failed to convert KAS to sompi: ${(error as Error).message}. Input amount was: "${amountStr}"`);
      }
      
      // Calculate or use custom fee
      let priorityFeeSompi: bigint = BigInt(0);
      
      if (customFee) {
        // Use custom fee if provided
        const customFeeStr = String(customFee).trim();
        if (isNaN(parseFloat(customFeeStr)) || parseFloat(customFeeStr) < 0) {
          throw new Error(`Invalid custom fee: "${customFeeStr}". Must be a non-negative number.`);
        }
        
        try {
          priorityFeeSompi = KaspaSDK.kasToSompi(customFeeStr);
          console.error(`[Debug] Using custom fee: ${customFeeStr} KAS = ${priorityFeeSompi} sompi`);
        } catch (error) {
          throw new Error(`Failed to convert custom fee: ${(error as Error).message}`);
        }
      } else if (priorityFee && priorityFee !== '0') {
        // Use deprecated priorityFee if provided (backward compatibility)
        const priorityFeeStr = String(priorityFee).trim();
        try {
          priorityFeeSompi = KaspaSDK.kasToSompi(priorityFeeStr);
          console.error(`[Debug] Using deprecated priorityFee: ${priorityFeeStr} KAS = ${priorityFeeSompi} sompi`);
        } catch (error) {
          throw new Error(`Failed to convert priority fee: ${(error as Error).message}`);
        }
      } else {
        // Calculate fee based on priority level
        // First, we need to get the sender address to estimate fees
        let senderAddress: string;
        if (from) {
          senderAddress = from;
        } else {
          // Get the first wallet address
          const privKey = wallet.getReceivePrivateKey(0);
          senderAddress = privKey.toAddress(sdk.getNetworkType()).toString();
        }
        
        console.error(`[Debug] Estimating fee for priority level: ${feePriority}`);
        
        // Get fee estimate from network
        const feeEstimate = await sdk.estimateFee(senderAddress, to, amountSompi);
        
        // Calculate fee multiplier based on priority
        let feeMultiplier = 1.0;
        switch (feePriority) {
          case 'low':
            feeMultiplier = 0.5; // 50% of base fee for low priority
            break;
          case 'normal':
            feeMultiplier = 1.0; // Base fee for normal priority
            break;
          case 'high':
            feeMultiplier = 2.0; // 2x base fee for high priority
            break;
          default:
            feeMultiplier = 1.0;
        }
        
        priorityFeeSompi = BigInt(Math.ceil(Number(feeEstimate.baseFee) * feeMultiplier));
        console.error(`[Debug] Calculated ${feePriority} priority fee: ${KaspaSDK.sompiToKas(priorityFeeSompi)} KAS (${priorityFeeSompi} sompi)`);
      }
      
      console.error(`[Debug] Final amounts - amount: ${amountSompi} sompi, fee: ${priorityFeeSompi} sompi`);

      // Handle sender address - if not provided, use wallet's first address
      let senderPrivateKey;
      let senderAddress: string = '';
      
      if (from) {
        // Find the private key for the specified address
        // For now, we'll check the first few addresses
        let found = false;
        for (let i = 0; i < 10; i++) {
          try {
            const privKey = wallet.getReceivePrivateKey(i);
            const addr = privKey.toAddress(sdk.getNetworkType()).toString();
            if (addr === from) {
              senderPrivateKey = privKey;
              senderAddress = addr;
              found = true;
              break;
            }
          } catch (e) {
            // Address at this index doesn't exist
            break;
          }
        }
        
        if (!found) {
          throw new Error(`Address ${from} not found in wallet. Please use an address from this wallet.`);
        }
      } else {
        // Use the first address if no 'from' specified
        senderPrivateKey = wallet.getReceivePrivateKey(0);
        senderAddress = senderPrivateKey.toAddress(sdk.getNetworkType()).toString();
        console.error(`[Info] No 'from' address specified, using wallet's first address: ${senderAddress}`);
      }
      
      console.error(`[Debug] Using address: ${senderAddress}`);

      const result = await sdk.sendTransaction({
        from: senderPrivateKey,  // Pass the private key
        to,
        amount: amountSompi,
        customTotalFee: customFee ? priorityFeeSompi : undefined,
        priorityFee: customFee ? undefined : priorityFeeSompi,
        payload
      });

      // Prepare fee info for response
      const feeUsed = customFee ? 'custom' : (priorityFee && priorityFee !== '0' ? 'legacy' : feePriority);
      const feeInfo = customFee 
        ? `Custom fee: ${customFee} KAS`
        : (priorityFee && priorityFee !== '0')
          ? `Priority fee (legacy): ${priorityFee} KAS`
          : `Fee priority: ${feePriority}`;
      
      return {
        content: [
          {
            type: 'text',
            text: `Transaction sent successfully!
Transaction ID: ${result.transactionId}
Amount: ${amount} KAS
Fee paid: ${KaspaSDK.sompiToKas(result.fee)} KAS
Fee type: ${feeInfo}
Mass: ${result.mass}
${payload ? `Payload: ${payload}` : ''}
Explorer: https://explorer.kaspa.org/txs/${result.transactionId}`
          }
        ]
      };
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to send transaction: ${(error as Error).message}`
      );
    }
  }

  private async handleEstimateFee(args: any) {
    const { sessionId = 'default', from, to, amount } = args;

    const sdk = sdkInstances.get(sessionId);
    if (!sdk) {
      throw new McpError(ErrorCode.InvalidRequest, 'No active connection. Please connect first.');
    }

    try {
      // Validate and format amount
      if (!amount || amount === '0') {
        throw new Error('Invalid amount: must be greater than 0');
      }
      
      const amountStr = String(amount).trim();
      
      // Validate amount format
      if (isNaN(parseFloat(amountStr))) {
        throw new Error(`Invalid amount format: "${amountStr}". Please provide a numeric value.`);
      }
      
      console.error(`[Debug] Estimating fee for amount: "${amountStr}" (type: ${typeof amountStr})`);
      
      let amountSompi: bigint;
      try {
        amountSompi = KaspaSDK.kasToSompi(amountStr);
        console.error(`[Debug] Amount converted to sompi: ${amountSompi}`);
      } catch (error) {
        console.error(`[Error] Failed to convert amount to sompi:`, error);
        throw new Error(`Failed to convert KAS amount: ${(error as Error).message}. Input amount was: "${amountStr}"`);
      }
      
      console.error(`[Debug] Calling estimateFee with from=${from}, to=${to}, amount=${amountSompi}`);
      const feeEstimate = await sdk.estimateFee(from, to, amountSompi);
      
      console.error(`[Debug] Fee estimate received:`, feeEstimate);

      return {
        content: [
          {
            type: 'text',
            text: `Fee estimate for ${amount} KAS transaction:
Base Fee: ${KaspaSDK.sompiToKas(feeEstimate.baseFee)} KAS
Total Fee: ${KaspaSDK.sompiToKas(feeEstimate.totalFee)} KAS
Estimated Mass: ${feeEstimate.estimatedMass}
Mass Limit: ${feeEstimate.massLimit}`
          }
        ]
      };
    } catch (error) {
      console.error(`[Error] Failed to estimate fee:`, error);
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to estimate fee: ${(error as Error).message}`
      );
    }
  }

  private async handleGetFeeRecommendations(args: any) {
    const { sessionId = 'default', from, to, amount } = args;

    const sdk = sdkInstances.get(sessionId);
    if (!sdk) {
      throw new McpError(ErrorCode.InvalidRequest, 'No active connection. Please connect first.');
    }

    try {
      // Validate and format amount
      if (!amount || amount === '0') {
        throw new Error('Invalid amount: must be greater than 0');
      }
      
      const amountStr = String(amount).trim();
      
      // Validate amount format
      if (isNaN(parseFloat(amountStr))) {
        throw new Error(`Invalid amount format: "${amountStr}". Please provide a numeric value.`);
      }
      
      console.error(`[Debug] Getting fee recommendations for amount: "${amountStr}"`);
      
      let amountSompi: bigint;
      try {
        amountSompi = KaspaSDK.kasToSompi(amountStr);
      } catch (error) {
        console.error(`[Error] Failed to convert amount to sompi:`, error);
        throw new Error(`Failed to convert KAS amount: ${(error as Error).message}. Input amount was: "${amountStr}"`);
      }
      
      // Get base fee estimate
      const baseFeeEstimate = await sdk.estimateFee(from, to, amountSompi);
      const baseFee = baseFeeEstimate.baseFee;
      
      // Calculate fees for different priority levels
      const lowFee = BigInt(Math.ceil(Number(baseFee) * 0.5));
      const normalFee = baseFee;
      const highFee = BigInt(Math.ceil(Number(baseFee) * 2.0));
      
      const minimumFee = BigInt(Math.max(1, Math.ceil(Number(baseFeeEstimate.estimatedMass) * 1))); // 1 sompi/gram minimum
      
      return {
        content: [
          {
            type: 'text',
            text: `📊 Fee Recommendations for ${amount} KAS Transaction

🐌 LOW Priority (1+ hour): ${KaspaSDK.sompiToKas(lowFee)} KAS
   Suitable for non-urgent transfers

⚡ NORMAL Priority (~1 minute): ${KaspaSDK.sompiToKas(normalFee)} KAS
   Recommended for most transactions

🚀 HIGH Priority (immediate): ${KaspaSDK.sompiToKas(highFee)} KAS
   For urgent/time-sensitive transfers

💰 Minimum Fee: ${KaspaSDK.sompiToKas(minimumFee)} KAS
   Network minimum (may take very long)

📏 Transaction Mass: ${baseFeeEstimate.estimatedMass}
📐 Mass Limit: ${baseFeeEstimate.massLimit}

Usage Examples:
• feePriority: "low" | "normal" | "high"
• customFee: "${KaspaSDK.sompiToKas(normalFee)}" (or any amount)`
          }
        ]
      };
    } catch (error) {
      console.error(`[Error] Failed to get fee recommendations:`, error);
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to get fee recommendations: ${(error as Error).message}`
      );
    }
  }

  private async handleGenerateMnemonic(args: any) {
    const { wordCount = 12 } = args;

    try {
      const mnemonic = KaspaSDK.generateMnemonic(wordCount);
      
      return {
        content: [
          {
            type: 'text',
            text: `Generated ${wordCount}-word mnemonic:
${mnemonic}

⚠️ SECURITY WARNING: Store this mnemonic securely and never share it!`
          }
        ]
      };
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to generate mnemonic: ${(error as Error).message}`
      );
    }
  }

  private async handleValidateAddress(args: any) {
    const { address, network } = args;

    try {
      const isValid = KaspaSDK.validateAddress(address, network);
      
      return {
        content: [
          {
            type: 'text',
            text: `Address validation result:
Address: ${address}
Valid: ${isValid ? '✅ Yes' : '❌ No'}
${network ? `Network: ${network}` : ''}`
          }
        ]
      };
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to validate address: ${(error as Error).message}`
      );
    }
  }

  private async handleGetWalletInfo(args: any) {
    const rawSessionId = args.sessionId;
    const sessionId = this.normalizeSessionId(rawSessionId);
    
    console.error(`[Debug] handleGetWalletInfo - raw sessionId: "${rawSessionId}", normalized: "${sessionId}"`);

    const sdk = sdkInstances.get(sessionId);
    const wallet = walletInstances.get(sessionId);
    
    console.error(`[Debug] handleGetWalletInfo - SDK found: ${!!sdk}, Wallet found: ${!!wallet}`);

    if (!sdk || !wallet) {
      throw new McpError(ErrorCode.InvalidRequest, 'No active wallet. Please create a wallet first.');
    }

    try {
      const receiveAddress = wallet.getReceiveAddress(0);
      const changeAddress = wallet.getChangeAddress(0);
      
      // Get balance for the main address
      const balance = await sdk.getBalance(receiveAddress);
      
      // Get first few addresses if they exist
      const addresses = [];
      for (let i = 0; i < 5; i++) {
        try {
          const addr = wallet.getReceiveAddress(i);
          addresses.push(`  [${i}] ${addr}`);
        } catch (e) {
          break;
        }
      }

      return {
        content: [
          {
            type: 'text',
            text: `Wallet Information:
Main Address: ${receiveAddress}
Change Address: ${changeAddress}
Balance: ${KaspaSDK.sompiToKas(balance.balance)} KAS
UTXOs: ${balance.utxoCount}

Available Addresses:
${addresses.join('\n')}

Mnemonic: ${wallet.getMnemonic()}`
          }
        ]
      };
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to get wallet info: ${(error as Error).message}`
      );
    }
  }

  private async handleSendFromWallet(args: any) {
    const { to, amount, addressIndex = 0, feePriority = 'normal', customFee, payload } = args;

    const sessionId = this.normalizeSessionId(args.sessionId);
    console.error(`[Debug] handleSendFromWallet using sessionId: "${sessionId}"`);

    const sdk = sdkInstances.get(sessionId);
    const wallet = walletInstances.get(sessionId);
    
    // Debug: Show all available sessions
    console.error(`[Debug] Available SDK sessions: ${Array.from(sdkInstances.keys()).join(', ')}`);
    console.error(`[Debug] Available wallet sessions: ${Array.from(walletInstances.keys()).join(', ')}`);
    console.error(`[Debug] Looking for session: "${sessionId}"`);
    console.error(`[Debug] SDK found: ${!!sdk}, Wallet found: ${!!wallet}`);
    
    if (!sdk) {
      throw new McpError(ErrorCode.InvalidRequest, 'No active connection. Please connect first.');
    }

    if (!wallet) {
      throw new McpError(ErrorCode.InvalidRequest, 'No wallet available. Please create or import a wallet first.');
    }

    try {
      // Validate and format amount
      if (!amount || amount === '0') {
        throw new Error('Invalid amount: must be greater than 0');
      }
      
      const amountStr = String(amount).trim();
      
      // Validate amount format
      if (isNaN(parseFloat(amountStr))) {
        throw new Error(`Invalid amount format: "${amountStr}". Please provide a numeric value.`);
      }
      
      // Convert to sompi
      let amountSompi: bigint;
      try {
        console.error(`[Debug] About to convert amount in sendFromWallet: "${amountStr}" (type: ${typeof amountStr})`);
        amountSompi = KaspaSDK.kasToSompi(amountStr);
        console.error(`[Debug] Amount conversion successful in sendFromWallet: ${amountSompi}`);
      } catch (error) {
        console.error(`[Error] Conversion failed in sendFromWallet for amount="${amountStr}", error:`, error);
        throw new Error(`Failed to convert amount: ${(error as Error).message}. Input amount was: "${amountStr}"`);
      }
      
      // Get the private key for the specified index
      const senderPrivateKey = wallet.getReceivePrivateKey(addressIndex);
      const senderAddress = senderPrivateKey.toAddress(sdk.getNetworkType()).toString();
      
      console.error(`[Info] Sending from wallet address[${addressIndex}]: ${senderAddress}`);
      console.error(`[Info] Amount: ${amountStr} KAS to ${to}, feePriority: ${feePriority}, customFee: ${customFee}`);

      // Calculate or use custom fee
      let priorityFeeSompi: bigint = BigInt(0);
      
      if (customFee) {
        // Use custom fee if provided
        const customFeeStr = String(customFee).trim();
        if (isNaN(parseFloat(customFeeStr)) || parseFloat(customFeeStr) < 0) {
          throw new Error(`Invalid custom fee: "${customFeeStr}". Must be a non-negative number.`);
        }
        
        try {
          priorityFeeSompi = KaspaSDK.kasToSompi(customFeeStr);
          console.error(`[Debug] Using custom fee in sendFromWallet: ${customFeeStr} KAS = ${priorityFeeSompi} sompi`);
        } catch (error) {
          throw new Error(`Failed to convert custom fee: ${(error as Error).message}`);
        }
      } else {
        // Calculate fee based on priority level
        console.error(`[Debug] Estimating fee for priority level in sendFromWallet: ${feePriority}`);
        
        // Get fee estimate from network
        const feeEstimate = await sdk.estimateFee(senderAddress, to, amountSompi);
        
        // Calculate fee multiplier based on priority
        let feeMultiplier = 1.0;
        switch (feePriority) {
          case 'low':
            feeMultiplier = 0.5; // 50% of base fee for low priority
            break;
          case 'normal':
            feeMultiplier = 1.0; // Base fee for normal priority
            break;
          case 'high':
            feeMultiplier = 2.0; // 2x base fee for high priority
            break;
          default:
            feeMultiplier = 1.0;
        }
        
        priorityFeeSompi = BigInt(Math.ceil(Number(feeEstimate.baseFee) * feeMultiplier));
        console.error(`[Debug] Calculated ${feePriority} priority fee in sendFromWallet: ${KaspaSDK.sompiToKas(priorityFeeSompi)} KAS (${priorityFeeSompi} sompi)`);
      }

      // Check balance before sending (including fee)
      const totalRequired = amountSompi + priorityFeeSompi;
      const balance = await sdk.getBalance(senderAddress);
      if (balance.balance < totalRequired) {
        throw new Error(`Insufficient balance. Available: ${KaspaSDK.sompiToKas(balance.balance)} KAS, Required: ${KaspaSDK.sompiToKas(totalRequired)} KAS (amount + fee)`);
      }

      const result = await sdk.sendTransaction({
        from: senderPrivateKey,
        to,
        amount: amountSompi,
        customTotalFee: customFee ? priorityFeeSompi : undefined,
        priorityFee: customFee ? undefined : priorityFeeSompi,
        payload
      });

      // Prepare fee info for response
      const feeInfo = customFee 
        ? `Custom fee: ${customFee} KAS`
        : `Fee priority: ${feePriority}`;
      
      return {
        content: [
          {
            type: 'text',
            text: `Transaction sent successfully!
From: ${senderAddress} (index ${addressIndex})
To: ${to}
Amount: ${amountStr} KAS
Fee paid: ${KaspaSDK.sompiToKas(result.fee)} KAS
Fee type: ${feeInfo}
Transaction ID: ${result.transactionId}
Mass: ${result.mass}${payload ? `\nPayload: ${payload}` : ''}
Explorer: https://explorer.kaspa.org/txs/${result.transactionId}`
          }
        ]
      };
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to send from wallet: ${(error as Error).message}`
      );
    }
  }

  private async handleSubscribeBalance(args: any) {
    const { sessionId = 'default', addresses, includeTransactions = true } = args;

    const sdk = sdkInstances.get(sessionId);
    const wallet = walletInstances.get(sessionId);
    
    if (!sdk) {
      throw new McpError(ErrorCode.InvalidRequest, 'No active connection. Please connect first.');
    }

    try {
      // Get addresses to monitor
      let addressesToMonitor: string[];
      
      if (addresses && addresses.length > 0) {
        // Use provided addresses
        addressesToMonitor = addresses;
      } else if (wallet) {
        // Use wallet addresses if no specific addresses provided
        addressesToMonitor = [];
        for (let i = 0; i < 5; i++) {
          try {
            const addr = wallet.getReceiveAddress(i);
            addressesToMonitor.push(addr);
          } catch (e) {
            break;
          }
        }
      } else {
        throw new Error('No addresses specified and no wallet available');
      }

      console.error(`[Debug] Subscribing to addresses: ${addressesToMonitor.join(', ')}`);

      // Initialize subscription info
      const subscriptionInfo: SubscriptionInfo = {
        addresses: new Set(addressesToMonitor),
        includeTransactions,
        lastBalances: new Map(),
      };

      // Get initial balances
      for (const address of addressesToMonitor) {
        try {
          const balance = await sdk.getBalance(address);
          subscriptionInfo.lastBalances.set(address, balance.balance);
        } catch (error) {
          console.error(`Error getting initial balance for ${address}:`, error);
          subscriptionInfo.lastBalances.set(address, BigInt(0));
        }
      }

      // Set up event listeners for transaction monitoring
      const eventListener = (data: any) => {
        this.handleBalanceChangeEvent(sessionId, data, subscriptionInfo);
      };

      // Subscribe to addresses in the SDK
      await sdk.subscribeToAddresses(addressesToMonitor);

      // Set up event handlers
      sdk.on('transaction:incoming', eventListener);
      sdk.on('transaction:spent', eventListener);
      sdk.on('balance:changed', eventListener);

      subscriptionInfo.eventListener = eventListener;
      subscriptionInstances.set(sessionId, subscriptionInfo);

      return {
        content: [
          {
            type: 'text',
            text: `✅ Subscribed to balance changes for ${addressesToMonitor.length} addresses:
${addressesToMonitor.map((addr, idx) => `  [${idx}] ${addr}`).join('\n')}

Initial balances:
${Array.from(subscriptionInfo.lastBalances.entries()).map(([addr, bal]) => 
  `  ${addr}: ${KaspaSDK.sompiToKas(bal)} KAS`
).join('\n')}

You will receive notifications when balances change.`
          }
        ]
      };
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to subscribe to balance changes: ${(error as Error).message}`
      );
    }
  }

  private async handleUnsubscribeBalance(args: any) {
    const { sessionId = 'default', addresses } = args;

    const sdk = sdkInstances.get(sessionId);
    const subscription = subscriptionInstances.get(sessionId);
    
    if (!sdk) {
      throw new McpError(ErrorCode.InvalidRequest, 'No active connection. Please connect first.');
    }

    if (!subscription) {
      return {
        content: [
          {
            type: 'text',
            text: '⚠️ No active subscription found'
          }
        ]
      };
    }

    try {
      let addressesToUnsubscribe: string[];
      
      if (addresses && addresses.length > 0) {
        // Unsubscribe from specific addresses
        addressesToUnsubscribe = addresses.filter((addr: string) => subscription.addresses.has(addr));
      } else {
        // Unsubscribe from all addresses
        addressesToUnsubscribe = Array.from(subscription.addresses);
      }

      if (addressesToUnsubscribe.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: '⚠️ No matching addresses found in subscription'
            }
          ]
        };
      }

      // Remove addresses from subscription
      for (const address of addressesToUnsubscribe) {
        subscription.addresses.delete(address);
        subscription.lastBalances.delete(address);
      }

      // Unsubscribe from SDK
      await sdk.unsubscribeFromAddresses(addressesToUnsubscribe);

      // If no addresses left, remove the entire subscription
      if (subscription.addresses.size === 0) {
        if (subscription.eventListener) {
          sdk.off('transaction:incoming', subscription.eventListener);
          sdk.off('transaction:spent', subscription.eventListener);
          sdk.off('balance:changed', subscription.eventListener);
        }
        subscriptionInstances.delete(sessionId);
      }

      return {
        content: [
          {
            type: 'text',
            text: `✅ Unsubscribed from ${addressesToUnsubscribe.length} addresses:
${addressesToUnsubscribe.join('\n')}

${subscription.addresses.size > 0 ? 
  `Still monitoring ${subscription.addresses.size} addresses.` : 
  'All subscriptions removed.'}`
          }
        ]
      };
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to unsubscribe: ${(error as Error).message}`
      );
    }
  }

  private async handleGetSubscriptionStatus(args: any) {
    const { sessionId = 'default' } = args;

    const subscription = subscriptionInstances.get(sessionId);
    
    if (!subscription || subscription.addresses.size === 0) {
      return {
        content: [
          {
            type: 'text',
            text: '📭 No active balance subscriptions'
          }
        ]
      };
    }

    try {
      const sdk = sdkInstances.get(sessionId);
      let balanceInfo = '';
      
      if (sdk) {
        // Get current balances
        const currentBalances: string[] = [];
        for (const address of subscription.addresses) {
          try {
            const balance = await sdk.getBalance(address);
            const lastBalance = subscription.lastBalances.get(address) || BigInt(0);
            const change = balance.balance - lastBalance;
            
            currentBalances.push(
              `  ${address}: ${KaspaSDK.sompiToKas(balance.balance)} KAS` +
              (change !== BigInt(0) ? ` (${change > 0 ? '+' : ''}${KaspaSDK.sompiToKas(change)} KAS)` : '')
            );
          } catch (error) {
            currentBalances.push(`  ${address}: Error getting balance`);
          }
        }
        balanceInfo = '\n\nCurrent Balances:\n' + currentBalances.join('\n');
      }

      return {
        content: [
          {
            type: 'text',
            text: `📊 Balance Subscription Status

Monitoring: ${subscription.addresses.size} addresses
Include Transactions: ${subscription.includeTransactions ? 'Yes' : 'No'}

Addresses:
${Array.from(subscription.addresses).map((addr, idx) => `  [${idx}] ${addr}`).join('\n')}${balanceInfo}`
          }
        ]
      };
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to get subscription status: ${(error as Error).message}`
      );
    }
  }

  private handleBalanceChangeEvent(sessionId: string, data: any, subscription: SubscriptionInfo) {
    try {
      // Check if this event is for one of our monitored addresses
      const address = data.address;
      if (!address || !subscription.addresses.has(address)) {
        return;
      }

      const eventType = data.type || 'unknown';
      
      console.error(`\n🔔 BALANCE CHANGE NOTIFICATION`);
      console.error(`   Session: ${sessionId}`);
      console.error(`   Address: ${address}`);
      console.error(`   Event: ${eventType}`);
      
      if (data.transactionId && subscription.includeTransactions) {
        console.error(`   Transaction: ${data.transactionId}`);
      }
      
      if (data.amount !== undefined) {
        const kasAmount = KaspaSDK.sompiToKas(data.amount);
        console.error(`   Amount: ${kasAmount} KAS`);
      }
      
      console.error(`   Timestamp: ${new Date().toLocaleString()}`);
      console.error('');

      // Update last known balance if we can get the current balance
      // Note: In a full implementation, you might want to trigger a balance refresh here
      
    } catch (error) {
      console.error(`Error handling balance change event:`, error);
    }
  }

  private async handleGetTransactionDetails(args: any) {
    const { sessionId = 'default', transactionId } = args;
    const sdk = sdkInstances.get(sessionId);

    if (!sdk) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        'No active connection. Please connect first.'
      );
    }

    if (!transactionId) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        'Transaction ID is required'
      );
    }

    try {
      console.error(`[Debug] Getting transaction details for: ${transactionId}`);
      
      const details = await sdk.getTransactionDetails(transactionId);
      
      // Format the response
      let response = `🔍 Transaction Details\n\n`;
      response += `Transaction ID: ${details.transactionId}\n`;
      
      if (details.blockHash) {
        response += `Block Hash: ${details.blockHash}\n`;
      }
      
      if (details.blockTime) {
        response += `Block Time: ${new Date(Number(details.blockTime)).toLocaleString()}\n`;
      }
      
      response += `Confirmations: ${details.confirmations}\n`;
      response += `Mass: ${details.mass}\n`;
      response += `Fee: ${details.feeKas} KAS (${details.fee} sompi)\n\n`;
      
      // Input details (senders)
      response += `📤 INPUTS (${details.inputs.length}):\n`;
      if (details.inputs.length === 0) {
        response += `   (No inputs - coinbase transaction)\n`;
      } else {
        for (const input of details.inputs) {
          response += `   From: ${input.address || 'Unknown'}\n`;
          response += `   Amount: ${input.amountKas} KAS\n`;
          response += `   Previous TX: ${input.previousTransactionId}:${input.previousIndex}\n`;
          response += `   ---\n`;
        }
      }
      
      response += `\n📥 OUTPUTS (${details.outputs.length}):\n`;
      for (const output of details.outputs) {
        response += `   [${output.index}] To: ${output.address}\n`;
        response += `   Amount: ${output.amountKas} KAS\n`;
        response += `   ---\n`;
      }
      
      response += `\n💰 AMOUNTS:\n`;
      response += `   Total Input: ${details.totalInputAmountKas} KAS\n`;
      response += `   Total Output: ${details.totalOutputAmountKas} KAS\n`;
      response += `   Fee: ${details.feeKas} KAS\n`;
      
      if (details.payload) {
        response += `\n📝 PAYLOAD:\n${details.payload}\n`;
      }
      
      if (details.lockTime) {
        response += `\n🔒 Lock Time: ${details.lockTime}\n`;
      }

      // Add explorer link
      const network = sdk.getNetworkType();
      const explorerBase = network === 'mainnet' 
        ? 'https://explorer.kaspa.org/txs/' 
        : 'https://explorer-tn10.kaspa.org/txs/';
      response += `\n🌐 Explorer: ${explorerBase}${transactionId}`;

      return {
        content: [
          {
            type: 'text',
            text: response
          }
        ]
      };
      
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to get transaction details: ${(error as Error).message}`
      );
    }
  }

  private async handleSetupPreconfiguredWallet(args: any) {
    const startTime = Date.now();
    console.error(`[Debug] handleSetupPreconfiguredWallet called at ${startTime} with args:`, JSON.stringify(args));
    
    const rawSessionId = args.sessionId;
    const sessionId = this.normalizeSessionId(rawSessionId);
    console.error(`[Debug] Raw sessionId: "${rawSessionId}", normalized to: "${sessionId}"`);
    
    let sdk = sdkInstances.get(sessionId);
    if (!sdk) {
      // Auto-connect to default network if no connection exists
      console.error(`[Info] No SDK connection found, auto-connecting to default network`);
      try {
        const defaultNetwork = Configuration.getDefaultNetwork();
        console.error(`[Debug] Auto-connecting to network: ${defaultNetwork}`);
        
        const connectStartTime = Date.now();
        await this.handleConnect({ 
          network: defaultNetwork, 
          sessionId 
        });
        const connectDuration = Date.now() - connectStartTime;
        console.error(`[Debug] Auto-connect completed in ${connectDuration}ms`);
        
        sdk = sdkInstances.get(sessionId);
        if (!sdk) {
          throw new Error('Failed to auto-connect');
        }
      } catch (error) {
        const errorTime = Date.now() - startTime;
        console.error(`[Error] Auto-connect failed after ${errorTime}ms:`, error);
        throw new McpError(
          ErrorCode.InvalidRequest, 
          'No active connection found. Please call kaspa_connect first to establish a connection to the Kaspa network before using wallet operations.'
        );
      }
    } else {
      console.error(`[Debug] Using existing SDK connection for session: ${sessionId}`);
    }

    try {
      console.error(`[Info] Setting up preconfigured wallet for session ${sessionId}`);
      
      // Check if preconfigured credentials are available
      const credentialsCheckTime = Date.now();
      if (!sdk.hasPreconfiguredWallet()) {
        throw new Error('No preconfigured wallet credentials found. Please set KASPA_WALLET_MNEMONIC or KASPA_WALLET_PRIVATE_KEY environment variables.');
      }
      console.error(`[Debug] Credentials check completed in ${Date.now() - credentialsCheckTime}ms`);
      
      // Dispose existing wallet if exists
      if (walletInstances.has(sessionId)) {
        console.error(`[Info] Disposing existing wallet`);
        const disposeStartTime = Date.now();
        walletInstances.get(sessionId)!.dispose();
        walletInstances.delete(sessionId);
        console.error(`[Debug] Wallet disposal completed in ${Date.now() - disposeStartTime}ms`);
      }

      console.error(`[Info] Creating wallet from preconfigured credentials...`);
      const walletCreateStartTime = Date.now();
      const wallet = sdk.createPreconfiguredWallet();
      const walletCreateDuration = Date.now() - walletCreateStartTime;
      console.error(`[Debug] Wallet creation completed in ${walletCreateDuration}ms`);
      
      walletInstances.set(sessionId, wallet);
      console.error(`[Info] Wallet created successfully`);

      const addressStartTime = Date.now();
      const receiveAddress = wallet.getReceiveAddress(0);
      const changeAddress = wallet.getChangeAddress(0);
      console.error(`[Debug] Address generation completed in ${Date.now() - addressStartTime}ms`);

      const responseText = `Preconfigured wallet setup successfully!
Receive Address: ${receiveAddress}
Change Address: ${changeAddress}
Network: ${sdk.getNetworkType()}

⚠️  Using wallet credentials from environment variables.
🔒 Private credentials are kept secure and not exposed to AI agents.`;

      const totalDuration = Date.now() - startTime;
      console.error(`[Debug] Total handleSetupPreconfiguredWallet duration: ${totalDuration}ms`);

      return {
        content: [
          {
            type: 'text',
            text: responseText
          }
        ]
      };
    } catch (error) {
      const totalDuration = Date.now() - startTime;
      console.error(`[Error] Failed to setup preconfigured wallet after ${totalDuration}ms:`, error);
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to setup preconfigured wallet: ${(error as Error).message}`
      );
    }
  }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Kaspa MCP server running on stdio');
  }
}

const server = new KaspaMCPServer();
server.run().catch(console.error);
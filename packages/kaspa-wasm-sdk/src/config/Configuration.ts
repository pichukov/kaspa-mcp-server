import { NetworkType } from '../types';
import * as kaspa from '../../wasm/kaspa';

export interface NetworkConfig {
  rpcUrl: string;
  encoding?: kaspa.Encoding;
}

export interface WalletCredentials {
  mnemonic?: string;
  privateKey?: string;
}

export interface SDKConfig {
  networks: {
    mainnet?: NetworkConfig;
    'testnet-10'?: NetworkConfig;
    devnet?: NetworkConfig;
    simnet?: NetworkConfig;
  };
  defaultNetwork?: NetworkType;
  logLevel?: 'off' | 'error' | 'warn' | 'info' | 'debug' | 'trace';
  autoConnect?: boolean;
  walletCredentials?: WalletCredentials;
}

/**
 * Default RPC URLs for different networks
 */
const DEFAULT_RPC_URLS: Record<NetworkType, string> = {
  'mainnet': 'ws://seeder2.kaspad.net:17110',
  'testnet-10': 'wss://photon-10.kaspa.red/kaspa/testnet-10/wrpc/borsh',
  'devnet': 'ws://127.0.0.1:16610',
  'simnet': 'ws://127.0.0.1:16510'
};

/**
 * Configuration manager for Kaspa SDK
 */
export class Configuration {
  private static instance: Configuration;
  private config: SDKConfig;

  private constructor() {
    // Initialize with default configuration
    this.config = {
      networks: {
        mainnet: {
          rpcUrl: DEFAULT_RPC_URLS.mainnet,
          encoding: kaspa.Encoding.Borsh
        },
        'testnet-10': {
          rpcUrl: DEFAULT_RPC_URLS['testnet-10'],
          encoding: kaspa.Encoding.Borsh
        },
        devnet: {
          rpcUrl: DEFAULT_RPC_URLS.devnet,
          encoding: kaspa.Encoding.Borsh
        },
        simnet: {
          rpcUrl: DEFAULT_RPC_URLS.simnet,
          encoding: kaspa.Encoding.Borsh
        }
      },
      defaultNetwork: 'mainnet',
      logLevel: 'info',
      autoConnect: true
    };
  }

  /**
   * Get singleton instance
   */
  static getInstance(): Configuration {
    if (!Configuration.instance) {
      Configuration.instance = new Configuration();
    }
    return Configuration.instance;
  }

  /**
   * Set global configuration
   */
  static setConfig(config: Partial<SDKConfig>): void {
    const instance = Configuration.getInstance();
    instance.mergeConfig(config);
  }

  /**
   * Get current configuration
   */
  static getConfig(): SDKConfig {
    return Configuration.getInstance().config;
  }

  /**
   * Set RPC URL for a specific network
   */
  static setNetworkRpcUrl(network: NetworkType, rpcUrl: string, encoding?: kaspa.Encoding): void {
    const instance = Configuration.getInstance();
    if (!instance.config.networks[network]) {
      instance.config.networks[network] = { rpcUrl };
    } else {
      instance.config.networks[network]!.rpcUrl = rpcUrl;
    }
    
    if (encoding !== undefined) {
      instance.config.networks[network]!.encoding = encoding;
    }
  }

  /**
   * Get RPC URL for a network
   */
  static getNetworkRpcUrl(network: NetworkType): string {
    const instance = Configuration.getInstance();
    return instance.config.networks[network]?.rpcUrl || DEFAULT_RPC_URLS[network];
  }

  /**
   * Get network configuration
   */
  static getNetworkConfig(network: NetworkType): NetworkConfig {
    const instance = Configuration.getInstance();
    return instance.config.networks[network] || {
      rpcUrl: DEFAULT_RPC_URLS[network],
      encoding: kaspa.Encoding.Borsh
    };
  }

  /**
   * Set default network
   */
  static setDefaultNetwork(network: NetworkType): void {
    Configuration.getInstance().config.defaultNetwork = network;
  }

  /**
   * Get default network
   */
  static getDefaultNetwork(): NetworkType {
    return Configuration.getInstance().config.defaultNetwork || 'mainnet';
  }

  /**
   * Set log level
   */
  static setLogLevel(level: 'off' | 'error' | 'warn' | 'info' | 'debug' | 'trace'): void {
    Configuration.getInstance().config.logLevel = level;
    kaspa.setLogLevel(level);
  }

  /**
   * Get wallet credentials from configuration
   */
  static getWalletCredentials(): WalletCredentials | undefined {
    return Configuration.getInstance().config.walletCredentials;
  }

  /**
   * Set wallet credentials
   */
  static setWalletCredentials(credentials: WalletCredentials): void {
    Configuration.getInstance().config.walletCredentials = credentials;
  }

  /**
   * Clear wallet credentials
   */
  static clearWalletCredentials(): void {
    delete Configuration.getInstance().config.walletCredentials;
  }

  /**
   * Reset to default configuration
   */
  static reset(): void {
    Configuration.instance = new Configuration();
  }

  /**
   * Load configuration from environment variables
   */
  static loadFromEnv(): void {
    const config: Partial<SDKConfig> = {
      networks: {}
    };

    // Load mainnet RPC URL
    if (process.env.KASPA_MAINNET_RPC_URL) {
      config.networks!.mainnet = {
        rpcUrl: process.env.KASPA_MAINNET_RPC_URL,
        encoding: kaspa.Encoding.Borsh
      };
    }

    // Load testnet RPC URL
    if (process.env.KASPA_TESTNET_RPC_URL) {
      config.networks!['testnet-10'] = {
        rpcUrl: process.env.KASPA_TESTNET_RPC_URL,
        encoding: kaspa.Encoding.Borsh
      };
    }

    // Load devnet RPC URL
    if (process.env.KASPA_DEVNET_RPC_URL) {
      config.networks!.devnet = {
        rpcUrl: process.env.KASPA_DEVNET_RPC_URL,
        encoding: kaspa.Encoding.Borsh
      };
    }

    // Load default network
    if (process.env.KASPA_DEFAULT_NETWORK) {
      config.defaultNetwork = process.env.KASPA_DEFAULT_NETWORK as NetworkType;
    }

    // Load log level
    if (process.env.KASPA_LOG_LEVEL) {
      config.logLevel = process.env.KASPA_LOG_LEVEL as any;
    }

    // Load wallet credentials from environment
    if (process.env.KASPA_WALLET_MNEMONIC || process.env.KASPA_WALLET_PRIVATE_KEY) {
      config.walletCredentials = {};
      
      if (process.env.KASPA_WALLET_MNEMONIC) {
        config.walletCredentials.mnemonic = process.env.KASPA_WALLET_MNEMONIC;
      }
      
      if (process.env.KASPA_WALLET_PRIVATE_KEY) {
        config.walletCredentials.privateKey = process.env.KASPA_WALLET_PRIVATE_KEY;
      }
    }

    Configuration.setConfig(config);
  }

  /**
   * Load configuration from JSON file
   */
  static async loadFromFile(filePath: string): Promise<void> {
    try {
      const fs = await import('fs/promises');
      const content = await fs.readFile(filePath, 'utf-8');
      const config = JSON.parse(content);
      Configuration.setConfig(config);
    } catch (error) {
      throw new Error(`Failed to load configuration from ${filePath}: ${error}`);
    }
  }

  /**
   * Save configuration to JSON file
   */
  static async saveToFile(filePath: string): Promise<void> {
    try {
      const fs = await import('fs/promises');
      const config = Configuration.getConfig();
      await fs.writeFile(filePath, JSON.stringify(config, null, 2));
    } catch (error) {
      throw new Error(`Failed to save configuration to ${filePath}: ${error}`);
    }
  }

  /**
   * Merge configuration
   */
  private mergeConfig(config: Partial<SDKConfig>): void {
    if (config.networks) {
      Object.keys(config.networks).forEach(network => {
        const networkKey = network as NetworkType;
        if (config.networks![networkKey]) {
          this.config.networks[networkKey] = {
            ...this.config.networks[networkKey],
            ...config.networks![networkKey]
          };
        }
      });
    }

    if (config.defaultNetwork !== undefined) {
      this.config.defaultNetwork = config.defaultNetwork;
    }

    if (config.logLevel !== undefined) {
      this.config.logLevel = config.logLevel;
      kaspa.setLogLevel(config.logLevel);
    }

    if (config.autoConnect !== undefined) {
      this.config.autoConnect = config.autoConnect;
    }

    if (config.walletCredentials !== undefined) {
      this.config.walletCredentials = config.walletCredentials;
    }
  }
}
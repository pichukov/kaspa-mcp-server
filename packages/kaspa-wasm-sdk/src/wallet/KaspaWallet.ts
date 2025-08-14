import * as kaspa from '../../wasm/kaspa';
import { WalletConfig, NetworkType } from '../types';
import { validateMnemonic } from '../utils';

export class KaspaWallet {
  private mnemonic?: kaspa.Mnemonic;
  private xprv?: kaspa.XPrv;
  private keyGenerator?: kaspa.PrivateKeyGenerator;
  private privateKey?: kaspa.PrivateKey;
  private networkType: NetworkType;
  private accountIndex: bigint;

  constructor(config: WalletConfig) {
    this.networkType = config.networkType;
    this.accountIndex = BigInt(config.accountIndex || 0);

    if (config.mnemonic) {
      this.initFromMnemonic(config.mnemonic, config.password);
    } else if (config.privateKey) {
      this.initFromPrivateKey(config.privateKey);
    } else {
      this.generateNew(config.password);
    }
  }

  /**
   * Initialize wallet from mnemonic
   */
  private initFromMnemonic(mnemonicPhrase: string, password?: string): void {
    if (!validateMnemonic(mnemonicPhrase)) {
      throw new Error('Invalid mnemonic phrase');
    }
    
    this.mnemonic = new kaspa.Mnemonic(mnemonicPhrase);
    const seed = this.mnemonic.toSeed(password);
    this.xprv = new kaspa.XPrv(seed);
    this.keyGenerator = new kaspa.PrivateKeyGenerator(
      this.xprv,
      false, // not multisig
      this.accountIndex
    );
  }

  /**
   * Initialize wallet from private key
   */
  private initFromPrivateKey(privateKeyHex: string): void {
    this.privateKey = new kaspa.PrivateKey(privateKeyHex);
  }

  /**
   * Generate new wallet
   */
  private generateNew(password?: string): void {
    this.mnemonic = kaspa.Mnemonic.random(12);
    const seed = this.mnemonic.toSeed(password);
    this.xprv = new kaspa.XPrv(seed);
    this.keyGenerator = new kaspa.PrivateKeyGenerator(
      this.xprv,
      false,
      this.accountIndex
    );
  }

  /**
   * Get mnemonic phrase
   */
  getMnemonic(): string | undefined {
    return this.mnemonic?.phrase;
  }

  /**
   * Get receive address at specific index
   */
  getReceiveAddress(index: number = 0): string {
    if (this.keyGenerator) {
      const key = this.keyGenerator.receiveKey(index);
      const address = key.toAddress(this.networkType);
      key.free();
      return address.toString();
    } else if (this.privateKey) {
      return this.privateKey.toAddress(this.networkType).toString();
    }
    throw new Error('Wallet not initialized');
  }

  /**
   * Get change address at specific index
   */
  getChangeAddress(index: number = 0): string {
    if (this.keyGenerator) {
      const key = this.keyGenerator.changeKey(index);
      const address = key.toAddress(this.networkType);
      key.free();
      return address.toString();
    } else if (this.privateKey) {
      // For single private key, use same address for change
      return this.privateKey.toAddress(this.networkType).toString();
    }
    throw new Error('Wallet not initialized');
  }

  /**
   * Get private key for receive address
   */
  getReceivePrivateKey(index: number = 0): kaspa.PrivateKey {
    if (this.keyGenerator) {
      return this.keyGenerator.receiveKey(index);
    } else if (this.privateKey && index === 0) {
      return this.privateKey;
    }
    throw new Error('Cannot get private key at index ' + index);
  }

  /**
   * Get private key for change address
   */
  getChangePrivateKey(index: number = 0): kaspa.PrivateKey {
    if (this.keyGenerator) {
      return this.keyGenerator.changeKey(index);
    } else if (this.privateKey && index === 0) {
      return this.privateKey;
    }
    throw new Error('Cannot get private key at index ' + index);
  }

  /**
   * Derive addresses for a range
   */
  deriveAddresses(startIndex: number, count: number, change: boolean = false): string[] {
    if (!this.keyGenerator) {
      throw new Error('HD wallet not available');
    }

    const addresses: string[] = [];
    for (let i = startIndex; i < startIndex + count; i++) {
      const key = change 
        ? this.keyGenerator.changeKey(i)
        : this.keyGenerator.receiveKey(i);
      addresses.push(key.toAddress(this.networkType).toString());
      key.free();
    }
    return addresses;
  }

  /**
   * Sign message
   */
  signMessage(message: string, addressIndex: number = 0): string {
    const privateKey = this.getReceivePrivateKey(addressIndex);
    const signature = kaspa.signMessage({
      message,
      privateKey: privateKey.toString()
    });
    if (privateKey !== this.privateKey) {
      privateKey.free();
    }
    return signature;
  }

  /**
   * Verify message signature
   */
  static verifyMessage(message: string, signature: string, publicKey: string): boolean {
    return kaspa.verifyMessage({
      message,
      signature,
      publicKey
    });
  }

  /**
   * Export wallet as object
   */
  export(): { mnemonic?: string; privateKey?: string } {
    return {
      mnemonic: this.mnemonic?.phrase,
      privateKey: this.privateKey?.toString()
    };
  }

  /**
   * Clean up WASM resources
   */
  dispose(): void {
    try {
      this.mnemonic?.free();
    } catch (e) {
      // Ignore - may already be freed
    }
    try {
      this.xprv?.free();
    } catch (e) {
      // Ignore - may already be freed
    }
    try {
      this.keyGenerator?.free();
    } catch (e) {
      // Ignore - may already be freed
    }
    try {
      this.privateKey?.free();
    } catch (e) {
      // Ignore - may already be freed
    }
  }
}
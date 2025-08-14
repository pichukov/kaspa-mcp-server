import * as kaspa from '../../wasm/kaspa';
import { NetworkType } from '../types';

/**
 * Convert string network type to WASM NetworkType enum
 */
export function getWasmNetworkType(networkType: NetworkType): kaspa.NetworkType {
  switch (networkType) {
    case 'mainnet':
      return kaspa.NetworkType.Mainnet;
    case 'testnet-10':
      return kaspa.NetworkType.Testnet;
    case 'devnet':
      return kaspa.NetworkType.Devnet;
    case 'simnet':
      return kaspa.NetworkType.Simnet;
    default:
      throw new Error(`Unknown network type: ${networkType}`);
  }
}

/**
 * Convert WASM NetworkType enum to string network type
 */
export function getStringNetworkType(wasmNetworkType: kaspa.NetworkType): NetworkType {
  switch (wasmNetworkType) {
    case kaspa.NetworkType.Mainnet:
      return 'mainnet';
    case kaspa.NetworkType.Testnet:
      return 'testnet-10';
    case kaspa.NetworkType.Devnet:
      return 'devnet';
    case kaspa.NetworkType.Simnet:
      return 'simnet';
    default:
      throw new Error(`Unknown WASM network type: ${wasmNetworkType}`);
  }
}

/**
 * Convert string network type to WASM NetworkId string
 */
export function getWasmNetworkId(networkType: NetworkType): string {
  switch (networkType) {
    case 'mainnet':
      return 'mainnet';
    case 'testnet-10':
      return 'testnet-10';
    case 'devnet':
      return 'devnet';
    case 'simnet':
      return 'simnet';
    default:
      throw new Error(`Unknown network type: ${networkType}`);
  }
}
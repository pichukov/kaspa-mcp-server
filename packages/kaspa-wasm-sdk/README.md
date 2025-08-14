# Kaspa WASM SDK

A complete TypeScript/JavaScript SDK for interacting with Kaspa using native WASM bindings. Provides comprehensive functionality for wallet management, transaction creation, UTXO handling, and real-time network monitoring.

## Features

- 🔐 **Wallet Management**: Create, import, and manage HD wallets
- 💸 **Transaction Building**: Create and sign transactions with automatic UTXO selection
- 📊 **Balance Tracking**: Real-time balance and UTXO monitoring
- 🔄 **UTXO Management**: Automatic UTXO selection and compounding
- 🌐 **Network Support**: Mainnet, Testnet, Devnet, and Simnet
- 📦 **Full TypeScript Support**: Complete type definitions

## Installation

This package is included as part of the kaspa-mcp-server workspace. If you want to use it standalone:

```bash
npm install kaspa-wasm-sdk
```

## Prerequisites

- Node.js 20.13.1 or higher
- A running Kaspa node (for RPC operations) or access to public nodes

## Configuration

### Basic Configuration

```typescript
import { KaspaSDK } from 'kaspa-wasm-sdk';

// Configure RPC URLs for different networks
KaspaSDK.setNetworkRpcUrl('mainnet', 'ws://your-mainnet-node.com:16110');
KaspaSDK.setNetworkRpcUrl('testnet-10', 'ws://your-testnet-node.com:16210');

// Set default network
KaspaSDK.setDefaultNetwork('testnet-10');
```

### Environment Variables

Create a `.env` file:

```bash
# Network Configuration
KASPA_MAINNET_RPC_URL=wss://api.kaspa.org:443
KASPA_TESTNET_RPC_URL=wss://photon-10.kaspa.red/kaspa/testnet-10/wrpc/borsh
KASPA_DEFAULT_NETWORK=mainnet
KASPA_LOG_LEVEL=info

# Wallet Configuration (Secure)
KASPA_WALLET_MNEMONIC="your twelve word mnemonic phrase here for testnet only"
KASPA_WALLET_PRIVATE_KEY=your_private_key_hex_here
```

Load from environment:

```typescript
import { Configuration } from 'kaspa-wasm-sdk';

// Load all configuration from environment variables
Configuration.loadFromEnv();
```

### Configuration File

Save and load configuration:

```typescript
// Save current configuration
await KaspaSDK.saveConfigToFile('./kaspa-config.json');

// Load configuration from file
await KaspaSDK.loadConfigFromFile('./kaspa-config.json');
```

### Global Configuration

```typescript
KaspaSDK.configure({
  networks: {
    mainnet: {
      rpcUrl: 'ws://mainnet.kaspa.org:16110'
    },
    'testnet-10': {
      rpcUrl: 'ws://testnet.kaspa.org:16210'
    }
  },
  defaultNetwork: 'testnet-10',
  logLevel: 'debug'
});
```

## Quick Start

### Initialize SDK

```typescript
import { KaspaSDK } from 'kaspa-wasm-sdk';

// Method 1: Use configured defaults
const sdk = new KaspaSDK();
await sdk.initialize();

// Method 2: Specify network and custom RPC URL
const sdk = new KaspaSDK('mainnet');
await sdk.initialize('ws://127.0.0.1:16110');

// Method 3: Configure in constructor
const sdk = new KaspaSDK('mainnet', {
  networks: {
    mainnet: {
      rpcUrl: 'ws://custom-node.example.com:16110'
    }
  }
});
await sdk.initialize();
```

### Create Wallet

```typescript
// Generate new wallet
const wallet = sdk.createWallet();
console.log('Mnemonic:', wallet.getMnemonic());
console.log('Address:', wallet.getReceiveAddress(0));

// Import from mnemonic
const imported = sdk.createWallet({
  mnemonic: 'your twelve word mnemonic phrase...'
});

// Import from private key
const fromKey = sdk.createWallet({
  privateKey: 'your_private_key_hex'
});

// Create wallet from preconfigured credentials (environment variables)
// Requires KASPA_WALLET_MNEMONIC or KASPA_WALLET_PRIVATE_KEY to be set
const preconfigured = sdk.createPreconfiguredWallet();
console.log('Address:', preconfigured.getReceiveAddress(0));

// Check if preconfigured credentials are available
if (sdk.hasPreconfiguredWallet()) {
  const wallet = sdk.createPreconfiguredWallet();
  console.log('Using preconfigured wallet');
}
```

### Check Balance

```typescript
// Single address
const balance = await sdk.getBalance('kaspa:qq...');
console.log('Balance:', KaspaSDK.sompiToKas(balance.balance), 'KAS');

// Multiple addresses
const balances = await sdk.getBalances(['kaspa:qq...', 'kaspa:qr...']);
```

### Send Transaction

```typescript
const result = await sdk.sendTransaction({
  from: senderAddress,
  to: recipientAddress,
  amount: KaspaSDK.kasToSompi('1.5'), // Send 1.5 KAS
  priorityFee: BigInt(0),
  payload: 'Optional message'
});

console.log('Transaction ID:', result.transactionId);
console.log('Fee:', KaspaSDK.sompiToKas(result.fee), 'KAS');
```

### Real-time Balance Tracking

```typescript
// Track addresses
await sdk.trackAddresses(['kaspa:qq...', 'kaspa:qr...']);

// Listen for balance updates
sdk.addEventListener('balance', (data) => {
  console.log('Balance updated:', data);
});

// Get tracked balance
const tracked = sdk.getTrackedBalance();
console.log('Mature:', KaspaSDK.sompiToKas(tracked.mature), 'KAS');
console.log('Pending:', KaspaSDK.sompiToKas(tracked.pending), 'KAS');
```

## Advanced Usage

### Transaction Building

```typescript
const builder = sdk.getTransactionBuilder();

// Estimate fees
const estimate = await builder.estimateFee(utxos, outputs, changeAddress);

// Build with custom options
const tx = await builder.buildTransaction(
  utxos,
  outputs,
  changeAddress,
  priorityFee,
  payload
);

// Sign transaction
const signed = builder.signTransaction(tx, [privateKey], true);

// Submit to network
const result = await builder.submitTransaction(signed, rpcClient);
```

### UTXO Management

```typescript
const utxoManager = sdk.getUtxoManager();

// Get mature UTXOs
const mature = await utxoManager.getMatureUTXOs();

// Select UTXOs for spending
const { selectedUtxos, totalAmount, change } = utxoManager.selectUTXOs(
  availableUtxos,
  targetAmount
);

// Compound UTXOs (consolidate)
const results = await sdk.compoundUTXOs(address, 100);
```

### Direct RPC Access

```typescript
const rpc = sdk.getRpcClient();

// Get block info
const blockDag = await rpc.getBlockDagInfo();

// Get mempool entry
const mempoolEntry = await rpc.getMempoolEntry(txId);

// Subscribe to events
await rpc.subscribeToBlocks();
rpc.addEventListener('block-added', (block) => {
  console.log('New block:', block);
});
```

## API Reference

### KaspaSDK

Main SDK class that provides high-level access to all functionality.

#### Methods

- `initialize(rpcUrl?)`: Connect to Kaspa node
- `createWallet(config?)`: Create or import wallet
- `createPreconfiguredWallet()`: Create wallet from environment variables
- `hasPreconfiguredWallet()`: Check if preconfigured credentials are available
- `getBalance(address)`: Get address balance
- `sendTransaction(config)`: Send transaction
- `estimateFee(from, to, amount)`: Estimate transaction fee
- `compoundUTXOs(address)`: Consolidate UTXOs
- `trackAddresses(addresses)`: Track addresses for updates
- `dispose()`: Clean up resources

### KaspaWallet

Wallet management with HD derivation support.

#### Methods

- `getMnemonic()`: Get mnemonic phrase
- `getReceiveAddress(index)`: Get receive address at index
- `getChangeAddress(index)`: Get change address at index
- `deriveAddresses(start, count, change?)`: Derive multiple addresses
- `signMessage(message, index)`: Sign message
- `dispose()`: Clean up WASM resources

### TransactionBuilder

Transaction creation and management.

#### Methods

- `buildTransaction(utxos, outputs, changeAddress, fee?, payload?)`: Build transaction
- `buildWithGenerator(utxos, outputs, changeAddress, fee?, payload?)`: Build with auto UTXO selection
- `estimateFee(utxos, outputs, changeAddress, fee?)`: Estimate transaction fee
- `signTransaction(tx, privateKeys, verify?)`: Sign transaction
- `submitTransaction(tx, rpcClient)`: Submit to network

### Configuration Functions

- `Configuration.setConfig(config)`: Set global configuration
- `Configuration.setNetworkRpcUrl(network, url, encoding?)`: Set RPC URL for network
- `Configuration.getNetworkRpcUrl(network)`: Get RPC URL for network
- `Configuration.setDefaultNetwork(network)`: Set default network
- `Configuration.loadFromEnv()`: Load config from environment variables
- `Configuration.loadFromFile(path)`: Load config from JSON file
- `Configuration.saveToFile(path)`: Save config to JSON file
- `Configuration.getConfig()`: Get current configuration
- `Configuration.getWalletCredentials()`: Get preconfigured wallet credentials
- `Configuration.setWalletCredentials(credentials)`: Set wallet credentials
- `Configuration.clearWalletCredentials()`: Clear wallet credentials
- `Configuration.reset()`: Reset to default configuration

### Utility Functions

- `KaspaSDK.generateMnemonic(wordCount?)`: Generate new mnemonic
- `KaspaSDK.validateMnemonic(phrase)`: Validate mnemonic phrase
- `KaspaSDK.validateAddress(address, network?)`: Validate address
- `KaspaSDK.kasToSompi(kas)`: Convert KAS to sompi
- `KaspaSDK.sompiToKas(sompi)`: Convert sompi to KAS

## Usage Examples

For usage examples, refer to the MCP server implementation in the root project which demonstrates how to integrate this SDK.

## Development

### Building

```bash
npm run build
```

### Testing

```bash
npm test
```

## Supported Networks

- **Mainnet**: Production network
- **Testnet-10**: Test network with suffix 10
- **Devnet**: Development network
- **Simnet**: Simulation network

## Important Notes

1. **WebSocket Polyfill**: SDK automatically configures WebSocket for Node.js environments
2. **Memory Management**: Call `.dispose()` on SDK objects to prevent WASM memory leaks
3. **UTXO Model**: Uses UTXO model; large UTXO sets may require multiple transactions
4. **Units**: 1 KAS = 100,000,000 sompi
5. **Transaction Limits**: Transactions have mass limits; use Generator for automatic splitting

## Security

- Never expose private keys or mnemonics
- Always validate addresses before sending
- Use environment variables for sensitive data
- Verify transaction details before signing

## License

MIT

## Support

For issues and questions, please open an issue on GitHub.
# Kaspa MCP Server

Model Context Protocol server for Kaspa operations using WASM SDK. Enables LLMs to interact with the Kaspa network through standardized MCP tools.

## Features

- 🔗 **Connect** to different Kaspa networks (mainnet, testnet-10, devnet, simnet)
- 👛 **Wallet Management** - Create, import, and manage HD wallets
- 💰 **Balance Checking** - Get balance and UTXO information
- 📤 **Send Transactions** - Send KAS with optional payloads/messages
- 📊 **Fee Estimation** - Calculate transaction fees
- 🔐 **Address Validation** - Validate Kaspa addresses
- 🎲 **Mnemonic Generation** - Generate secure wallet mnemonics

## Setup

```bash
npm run install-all
npm run build
```

## Environment Variables

The MCP server supports several environment variables for configuration:

### Network Configuration
- `KASPA_DEFAULT_NETWORK`: Default network to use (`mainnet`, `testnet-10`, `devnet`, `simnet`)
- `KASPA_MAINNET_RPC_URL`: Custom mainnet RPC endpoint
- `KASPA_TESTNET_RPC_URL`: Custom testnet RPC endpoint
- `KASPA_LOG_LEVEL`: Logging level (`off`, `error`, `warn`, `info`, `debug`, `trace`)

### Wallet Configuration (Secure)
- `KASPA_WALLET_MNEMONIC`: Preconfigured wallet mnemonic phrase (12-24 words)
- `KASPA_WALLET_PRIVATE_KEY`: Preconfigured wallet private key (hex format)

**Security Note:** Use environment variables to keep sensitive wallet credentials away from AI agents and conversation logs.

### Example .env file
```bash
KASPA_DEFAULT_NETWORK=testnet-10
KASPA_TESTNET_RPC_URL=wss://photon-10.kaspa.red/kaspa/testnet-10/wrpc/borsh
KASPA_WALLET_MNEMONIC="your twelve word mnemonic phrase here for testnet use only"
KASPA_LOG_LEVEL=info
```

## Usage

### As MCP Server

Add to your MCP client configuration:

#### Basic Configuration
```json
{
  "mcpServers": {
    "kaspa": {
      "command": "node",
      "args": ["/path/to/kaspa-mcp-server/dist/index.js"]
    }
  }
}
```

**Note:** The configuration field name varies by MCP client:
- **Claude Desktop**: Use `"mcpServers"`
- **Other MCP clients**: May use `"servers"` or `"mcp_servers"`
- **Custom implementations**: Check your client's documentation for the correct field name

#### Configuration with Preconfigured Wallet (Recommended)
For secure operation with environment variables:

```json
{
  "mcpServers": {
    "kaspa": {
      "command": "node",
      "args": ["/path/to/kaspa-mcp-server/dist/index.js"],
      "env": {
        "KASPA_WALLET_MNEMONIC": "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
        "KASPA_DEFAULT_NETWORK": "testnet-10",
        "KASPA_LOG_LEVEL": "info"
      }
    }
  }
}
```

**Security Note**: Replace the example mnemonic with your own wallet's mnemonic phrase. This keeps your wallet credentials secure and away from AI conversation logs.

### Development

```bash
npm run dev
```

## Available Tools

### 1. 🔌 `kaspa_connect` (STEP 1)
Connect to a Kaspa network. **This must be called first** before using any wallet or transaction tools.

**Parameters:**
- `network` (required): Network type (`mainnet`, `testnet-10`, `devnet`, `simnet`) - Use `testnet-10` for testing
- `rpcUrl` (optional): Custom RPC endpoint
- `sessionId` (optional): Session identifier (default: `default`)

**Example:**
```json
{
  "name": "kaspa_connect",
  "arguments": {
    "network": "testnet-10",
    "sessionId": "my-session"
  }
}
```

### 2. `kaspa_create_wallet`
Create or import a Kaspa wallet.

**Parameters:**
- `sessionId` (optional): Session identifier
- `mnemonic` (optional): Import from mnemonic phrase
- `privateKey` (optional): Import from private key

**Example:**
```json
{
  "name": "kaspa_create_wallet",
  "arguments": {
    "sessionId": "my-session"
  }
}
```

### 3. `kaspa_get_balance`
Get balance for a Kaspa address.

**Parameters:**
- `address` (required): Kaspa address to check
- `sessionId` (optional): Session identifier

**Example:**
```json
{
  "name": "kaspa_get_balance",
  "arguments": {
    "address": "kaspa:qq..."
  }
}
```

### 4. `kaspa_send_transaction`
Send a Kaspa transaction.

**Parameters:**
- `from` (required): Sender address
- `to` (required): Recipient address  
- `amount` (required): Amount in KAS (e.g., "1.5")
- `priorityFee` (optional): Priority fee in KAS
- `payload` (optional): Message/data to attach
- `sessionId` (optional): Session identifier

**Example:**
```json
{
  "name": "kaspa_send_transaction",
  "arguments": {
    "from": "kaspa:qq...",
    "to": "kaspa:qr...",
    "amount": "1.5",
    "payload": "Payment for services"
  }
}
```

### 5. `kaspa_estimate_fee`
Estimate transaction fees.

**Parameters:**
- `from` (required): Sender address
- `to` (required): Recipient address
- `amount` (required): Amount in KAS
- `sessionId` (optional): Session identifier

### 6. `kaspa_generate_mnemonic`
Generate a new mnemonic phrase.

**Parameters:**
- `wordCount` (optional): Number of words (12, 15, 18, 21, 24)

### 7. `kaspa_validate_address`
Validate a Kaspa address.

**Parameters:**
- `address` (required): Address to validate
- `network` (optional): Network for validation

### 8. `kaspa_setup_preconfigured_wallet`
Setup wallet using preconfigured credentials from environment variables.

**Parameters:**
- `sessionId` (optional): Session identifier

**Environment Variables Required:**
- `KASPA_WALLET_MNEMONIC`: 12-24 word mnemonic phrase
- `KASPA_WALLET_PRIVATE_KEY`: Private key in hex format

**Example:**
```json
{
  "name": "kaspa_setup_preconfigured_wallet",
  "arguments": {}
}
```

### 9. `kaspa_get_wallet_info`
Get wallet information.

**Parameters:**
- `sessionId` (optional): Session identifier

## Session Management

The server supports multiple concurrent sessions using `sessionId` parameters. Each session maintains its own:
- Network connection
- Wallet instance
- Configuration

## Security Notes

- 🔒 Never log or expose private keys or mnemonics
- 🌐 Use testnet for development and testing
- 💾 Wallet credentials are kept in memory only (not persisted)
- 🧹 Resources are automatically cleaned up on server shutdown
- 🔐 **Preconfigured Wallets**: Use environment variables to keep sensitive credentials away from AI agents
- ⚠️ **Environment Security**: Ensure your .env files are not committed to version control

## Network Endpoints

Default endpoints:
- **Mainnet**: `ws://seeder2.kaspad.net:17110` ✅ **Public endpoint**
- **Testnet-10**: `wss://photon-10.kaspa.red/kaspa/testnet-10/wrpc/borsh` ✅ **Public endpoint**
- **Devnet**: `ws://127.0.0.1:16610` (requires local node)
- **Simnet**: `ws://127.0.0.1:16510` (requires local node)

### Address Formats by Network

- **Mainnet addresses**: Start with `kaspa:` (e.g., `kaspa:qz...`)
- **Testnet addresses**: Start with `kaspatest:` (e.g., `kaspatest:qr...`)
- **Devnet addresses**: Start with `kaspadev:` (e.g., `kaspadev:qp...`)
- **Simnet addresses**: Start with `kaspasim:` (e.g., `kaspasim:qq...`)

**⚠️ Important**: Addresses are network-specific. You cannot send from a mainnet wallet to a testnet address or vice versa.

## Error Handling

All tools return structured error messages with:
- Error code (following MCP standards)
- Descriptive error message
- Context about the failure

## Examples

### Basic Workflow

1. **Connect to testnet:**
```json
{"name": "kaspa_connect", "arguments": {"network": "testnet-10"}}
```

2. **Create a wallet:**
```json
{"name": "kaspa_create_wallet", "arguments": {}}
```

3. **Check balance:**
```json
{"name": "kaspa_get_balance", "arguments": {"address": "kaspatest:qq..."}}
```

4. **Send transaction:**
```json
{
  "name": "kaspa_send_transaction",
  "arguments": {
    "from": "kaspatest:qq...",
    "to": "kaspatest:qr...",
    "amount": "0.1",
    "payload": "Test transaction from MCP"
  }
}
```

### Secure Workflow (Preconfigured Wallet)

When using the preconfigured wallet configuration (with environment variables in your MCP client config):

1. **Setup preconfigured wallet:**
```json
{"name": "kaspa_setup_preconfigured_wallet", "arguments": {}}
```

2. **Get wallet info:**
```json
{"name": "kaspa_get_wallet_info", "arguments": {}}
```

3. **Send transaction (no private keys exposed to AI):**
```json
{
  "name": "kaspa_send_from_wallet",
  "arguments": {
    "to": "kaspatest:qr...",
    "amount": "0.1",
    "feePriority": "normal",
    "payload": "Optional message"
  }
}
```

**Benefits:**
- 🔒 **Secure**: Private credentials never appear in AI conversation logs
- ⚡ **Fast**: No need to manually connect or create wallets each time  
- 🔄 **Consistent**: Same wallet used across sessions
- 🛡️ **Safe**: Environment variables keep sensitive data away from AI agents

## Development

```bash
# Install all dependencies (workspace + nested packages)
npm run install-all

# Build everything (SDK first, then MCP server)
npm run build

# Development mode
npm run dev

# Run production server
npm start

# Clean build artifacts
npm run clean
```

## License

MIT
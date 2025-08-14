#!/usr/bin/env node

/**
 * Simple Kaspa MCP Client Example (ES Module)
 * 
 * This demonstrates how to connect to the Kaspa MCP server
 * from an external Node.js application
 */

import { spawn } from 'child_process';
import readline from 'readline';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class SimpleMCPClient {
  constructor() {
    this.requestId = 0;
    this.pendingRequests = new Map();
    this.isInitialized = false;
  }

  connect() {
    console.log('🚀 Starting Kaspa MCP Server...');
    
    // Spawn the MCP server process
    this.server = spawn('node', [
      join(__dirname, '..', 'dist', 'index.js')
    ], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    // Set up line reader for responses
    this.rl = readline.createInterface({
      input: this.server.stdout
    });

    // Handle responses
    this.rl.on('line', (line) => {
      try {
        const response = JSON.parse(line);
        this.handleResponse(response);
      } catch (e) {
        console.log('📝 Server output:', line);
      }
    });

    // Handle errors/notifications (stderr)
    this.server.stderr.on('data', (data) => {
      const message = data.toString();
      
      // Check for balance change notifications
      if (message.includes('BALANCE CHANGE NOTIFICATION')) {
        console.log('\n' + message);
      } else if (message.includes('Kaspa MCP server running')) {
        console.log('✅ MCP Server is running');
      } else if (message.includes('[Debug]') || message.includes('[Info]')) {
        // Optionally show debug info
        // console.log('Debug:', message);
      } else if (message.includes('🔔')) {
        // Show notifications
        console.log(message);
      }
    });

    // Handle server exit
    this.server.on('exit', (code) => {
      console.log(`Server exited with code ${code}`);
      process.exit(code);
    });

    // Initialize the connection
    return this.initialize();
  }

  initialize() {
    return this.sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: {
        name: 'kaspa-simple-client',
        version: '1.0.0'
      }
    }).then(() => {
      this.isInitialized = true;
      console.log('✅ Connected to Kaspa MCP Server\n');
    });
  }

  sendRequest(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.requestId;
      const request = {
        jsonrpc: '2.0',
        method: method,
        params: params,
        id: id
      };

      this.pendingRequests.set(id, { resolve, reject });
      this.server.stdin.write(JSON.stringify(request) + '\n');
    });
  }

  handleResponse(response) {
    if (response.id && this.pendingRequests.has(response.id)) {
      const { resolve, reject } = this.pendingRequests.get(response.id);
      this.pendingRequests.delete(response.id);

      if (response.error) {
        reject(new Error(response.error.message));
      } else {
        resolve(response.result);
      }
    }
  }

  async callTool(toolName, args = {}) {
    if (!this.isInitialized) {
      throw new Error('Client not initialized');
    }

    console.log(`\n📞 Calling: ${toolName}`);
    if (Object.keys(args).length > 0) {
      console.log('   Args:', JSON.stringify(args, null, 2));
    }

    const result = await this.sendRequest('tools/call', {
      name: toolName,
      arguments: args
    });

    // Extract text content from response
    if (result && result.content && Array.isArray(result.content)) {
      const textContent = result.content
        .filter(c => c.type === 'text')
        .map(c => c.text)
        .join('\n');
      return textContent;
    }

    return result;
  }

  async listTools() {
    const result = await this.sendRequest('tools/list');
    return result.tools;
  }

  disconnect() {
    console.log('\n👋 Disconnecting...');
    if (this.server) {
      this.server.kill();
    }
  }
}

// Example usage
async function main() {
  const client = new SimpleMCPClient();

  try {
    // Connect to MCP server
    await client.connect();

    // List available tools
    console.log('📋 Available Tools:');
    const tools = await client.listTools();
    tools.forEach(tool => {
      console.log(`   - ${tool.name}: ${tool.description}`);
    });
    console.log('');

    // Example 1: Connect to Kaspa network
    console.log('Example 1: Connecting to Kaspa testnet');
    const connectResult = await client.callTool('kaspa_connect', {
      network: 'testnet-10'
    });
    console.log('Result:', connectResult);

    // Example 2: Generate a mnemonic
    console.log('\nExample 2: Generating a new mnemonic');
    const mnemonicResult = await client.callTool('kaspa_generate_mnemonic', {
      wordCount: 12
    });
    console.log('Result:', mnemonicResult);

    // Example 3: Create a wallet
    console.log('\nExample 3: Creating a wallet');
    const walletResult = await client.callTool('kaspa_create_wallet', {});
    console.log('Result:', walletResult);

    // Example 4: Get wallet info
    console.log('\nExample 4: Getting wallet info');
    const walletInfo = await client.callTool('kaspa_get_wallet_info', {});
    console.log('Result:', walletInfo);

    // Example 5: Subscribe to balance changes
    console.log('\nExample 5: Subscribing to balance changes');
    const subscribeResult = await client.callTool('kaspa_subscribe_balance', {});
    console.log('Result:', subscribeResult);

    // Example 6: Check subscription status
    console.log('\nExample 6: Checking subscription status');
    const statusResult = await client.callTool('kaspa_get_subscription_status', {});
    console.log('Result:', statusResult);

    // Example 7: Validate an address
    console.log('\nExample 7: Validating an address');
    const validateResult = await client.callTool('kaspa_validate_address', {
      address: 'kaspatest:qq0d6h0prjm5mpdld5pncst3adu0yam6xch4tr69k2q0c3xs6tt5zvgqktzqy',
      network: 'testnet-10'
    });
    console.log('Result:', validateResult);

    // Wait a bit to see any notifications
    console.log('\n⏰ Waiting 5 seconds for any balance change notifications...');
    console.log('   (Send some TKAS to the wallet address to see notifications)');
    
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Unsubscribe
    console.log('\nUnsubscribing from balance changes...');
    const unsubscribeResult = await client.callTool('kaspa_unsubscribe_balance', {});
    console.log('Result:', unsubscribeResult);

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    // Disconnect
    client.disconnect();
  }
}

// Run the example
main().catch(console.error);

export { SimpleMCPClient };
module.exports = {
  networks: {
    development: {
      host: "127.0.0.1",
      port: 7545,            // Matching your Ganache GUI
      network_id: "*"        // Match any network id
    },
    sepolia: {
      provider: () => {
        const HDWalletProvider = require('@truffle/hdwallet-provider');
        return new HDWalletProvider(
          process.env.PRIVATE_KEY,
          process.env.SEPOLIA_RPC_URL || `https://sepolia.infura.io/v3/${process.env.INFURA_API_KEY}`
        );
      },
      network_id: 11155111,
      gas: 4465030,
      confirmations: 2,
      timeoutBlocks: 200,
      skipDryRun: true
    }
  },
  compilers: {
    solc: {
      version: "0.8.20",
      settings: {
        evmVersion: "london"  // <-- ADD THIS LINE! Avoids PUSH0 opcode error in Ganache
      }
    }
  }
};
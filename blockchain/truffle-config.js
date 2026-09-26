module.exports = {
  networks: {
    development: {
      host: "127.0.0.1",
      port: 7545,            // Matching your Ganache GUI
      network_id: "*"        // Match any network id
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
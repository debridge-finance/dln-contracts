import { config as dotenv } from 'dotenv';

import 'hardhat-deploy';
import '@nomicfoundation/hardhat-toolbox'
import '@openzeppelin/hardhat-upgrades';
import '@nomiclabs/hardhat-truffle5'
import 'hardhat-contract-sizer';
import '@debridge-finance/hardhat-debridge';

dotenv();
module.exports = {
  gasReporter: {
    enabled: !process.env.NOGASREPORT,
    currency: "USD",
    gasPrice: 100,
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
    deploy: "./scripts/deploy"
  },

  networks: {
    hardhat: {
      chainId: 137
    },
    localhost: {
      chainId: 59144
    },
    kovan: {
      url: "https://kovan.infura.io/v3/9aa3d95b3bc440fa88ea12eaa4456161",
      accounts: [process.env.DEPLOYER_PRIVATE_KEY],
      chainId: 42
    },
    bsctest: {
      url: "https://data-seed-prebsc-1-s2.binance.org:8545/",
      accounts: [process.env.DEPLOYER_PRIVATE_KEY],
      chainId: 97
    },
    hecotest: {
      url: "https://http-testnet.hecochain.com/",
      accounts: [process.env.DEPLOYER_PRIVATE_KEY],
      chainId: 256
    },
    arethtest: {
      url: "https://rinkeby.arbitrum.io/rpc",
      accounts: [process.env.DEPLOYER_PRIVATE_KEY],
      chainId: 421611
    },
    mumbai: {
      url: "https://rpc-mumbai.maticvigil.com",
      accounts: [process.env.DEPLOYER_PRIVATE_KEY],
      chainId: 80001
    },
    RINKEBY: {
      url: "https://rinkeby.infura.io/v3/9aa3d95b3bc440fa88ea12eaa4456161",
      accounts: [process.env.DEPLOYER_PRIVATE_KEY],
      chainId: 4
    },
    ETH: {
      url: "https://mainnet.infura.io/v3/9aa3d95b3bc440fa88ea12eaa4456161",
      accounts: [process.env.DEPLOYER_PRIVATE_KEY],
      // gasPrice: 17e9,
      chainId: 1
    },
    BSC: {
      url: "https://bsc-dataseed.binance.org/",
      accounts: [process.env.DEPLOYER_PRIVATE_KEY],
      gasPrice: 3e9,
      chainId: 56
    },
    HECO: {
      url: "https://http-mainnet.hecochain.com",
      accounts: [process.env.DEPLOYER_PRIVATE_KEY],
      chainId: 128
    },
    MATIC: {
      url: "https://polygon-mainnet.infura.io/v3/9aa3d95b3bc440fa88ea12eaa4456161",
      accounts: [process.env.DEPLOYER_PRIVATE_KEY],
      chainId: 137,
    },
    ARBITRUM: {
      url: "https://arb1.arbitrum.io/rpc",
      accounts: [process.env.DEPLOYER_PRIVATE_KEY],
      chainId: 42161
    },
    FANTOM: {
      url: "https://rpc.ftm.tools/",
      accounts: [process.env.DEPLOYER_PRIVATE_KEY],
      chainId: 250
    },
    fantomTest: {
      url: "https://rpc.testnet.fantom.network/",
      accounts: [process.env.DEPLOYER_PRIVATE_KEY],
      chainId: 4002
    },
    AVALANCHE: {
      url: "https://api.avax.network/ext/bc/C/rpc",
      accounts: [process.env.DEPLOYER_PRIVATE_KEY],
      chainId: 43114
    },
    avalancheTest: {
      url: "https://api.avax-test.network/ext/bc/C/rpc",
      accounts: [process.env.DEPLOYER_PRIVATE_KEY],
      chainId: 43113
    },
    Linea: {
      url: "https://linea-mainnet.infura.io/v3/9aa3d95b3bc440fa88ea12eaa4456161",
      // url: "http://127.0.0.1:8545/",
      accounts: [process.env.DEPLOYER_PRIVATE_KEY],
      // gasPrice: 7e9,
      chainId: 59144
    },
    Base: {
      url: "https://base-mainnet.public.blastapi.io",
      accounts: [process.env.DEPLOYER_PRIVATE_KEY],
      chainId: 8453
    },
    OP: {
      url: "https://optimism-mainnet.infura.io/v3/9aa3d95b3bc440fa88ea12eaa4456161",
      accounts: [process.env.DEPLOYER_PRIVATE_KEY],
      chainId: 10
    },
    optimisticEthereum: {
      url: "https://optimism-mainnet.infura.io/v3/9aa3d95b3bc440fa88ea12eaa4456161",
      accounts: [process.env.DEPLOYER_PRIVATE_KEY],
      chainId: 10
    },
  },
  namedAccounts: {
    deployer: 0
  },

  solidity: {
    compilers: [
      {
        version: "0.8.17",
        settings: {
          optimizer: {
            enabled: true,
            runs: 999
          }
        }
      },
    ],
    overrides: {
      "@debridge-finance/debridge-contracts-v1/contracts/mock/MockDeBridgeGate.sol": {
        version: "0.8.7",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200
          }
        }
      },
      "contracts/mock/MockDlnDestination.sol": {
        version: "0.8.17",
        settings: {
          optimizer: {
            enabled: true,
            runs: 999
          }
        }
      }
    }
  },
  etherscan: {
    apiKey: {
      mainnet: process.env.ETHERSCAN_ETH_API_KEY,
      polygon: process.env.ETHERSCAN_POLYGON_API_KEY,
      arbitrumOne: process.env.ETHERSCAN_ARBITRUMONE_API_KEY,
      avalanche: process.env.ETHERSCAN_AVALANCHE_API_KEY,
      bsc: process.env.ETHERSCAN_BSC_API_KEY,
      opera: process.env.ETHERSCAN_FANTOM_API_KEY,
      Base: process.env.ETHERSCAN_BASE_API_KEY,
      optimisticEthereum: process.env.ETHERSCAN_OP_API_KEY,
      OP: process.env.ETHERSCAN_OP_API_KEY,
      Linea: process.env.ETHERSCAN_LINEA_API_KEY,
    },
    customChains: [
      {
        network: "Base",
        chainId: 8453,
        urls: {
          apiURL: "https://api.basescan.org/api",
          browserURL: "https://basescan.org"
        }
      },
      {
        network: "OP",
        chainId: 10,
        urls: {
          apiURL: "https://api-optimistic.etherscan.io/api",
          browserURL: "https://optimistic.etherscan.io/"
        }
      },
      {
        network: "Linea",
        chainId: 59144,
        urls: {
          apiURL: "https://api.lineascan.build/api",
          browserURL: "https://lineascan.build/"
        }
      }
    ],
  }
};

#  DLN

DLN is a high-performance cross-chain trading infrastructure that consists of two layers:
Protocol layer: on-chain smart contracts
Infrastructure layer: Takers that perform off-chain matching and on-chain settlement of trades
The DLN protocol layer is represented by a set of smart contracts that can be called by any on-chain address (named a Maker) to create limit orders for cross-chain trades. When an order is created, the maker provides a specific amount of an input token on the source chain and specifies the parameters of the order, such as the token address and the amount the maker accepts to receive in the destination chain. The given amount is then temporarily locked by the DLN smart contract on the source chain, and any on-chain address with sufficient liquidity (named a Taker) can attempt to fulfill the order by calling the DLN smart contract on the destination chain and supplying the corresponding amount of token as requested by the maker. After the order is fulfilled, a cross-chain message is sent by the smart contract to the source chain via the deBridge messaging infrastructure to unlock the funds on the source chain to the taker’s address, effectively completing the order. Below is a graphic outlining the process:

![tg_image_226044199](https://github.com/debridge-finance/dln-contracts/assets/29544129/d17a30a4-3186-4601-850c-1a30b6bc4ef6)

More information about the project can be also found in the [documentation portal](https://docs.dln.trade/the-core-protocol/dln-overview)  
UI deployed on [app.debridge.finance](https://app.debridge.finance/)

## DLN Smart Contracts
The contracts' directory contains the following subfolders:

contracts/  
	DLN/ - dln contracts  
	interfaces/ - contains interfaces of the project contracts  
	libraries/ - libraries created for the project  
	mock/ - contracts for tests  
        
## Prod addresses
| contract  | address 
| -- | -- |
| DlnSource|0xeF4fB24aD0916217251F553c0596F8Edc630EB66
| DlnDestination |0xE7351Fd770A37282b91D153Ee690B63579D6dd7f
        
## Deployed Chains
- 1,56,137,250,42161,43114,59144,10,8453,100000001,100000002,100000003,100000004
- ETH, BNB, POLYGON, FANTOM, ARBITRUM, AVALANCHE, LINEA, OPTIMISM, BASE, NEON, GNOSIS, LIGHTLINK, METIS

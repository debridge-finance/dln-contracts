const debridgeInitParams = require("../../assets/debridgeInitParams");
const { getLastDeployedProxy, waitTx } = require("../deploy-utils");

module.exports = async function ({ getNamedAccounts, deployments, network }) {
  const { deployer } = await getNamedAccounts();
  const deployInitParams = debridgeInitParams[network.name];
  if (!deployInitParams) return;

  const dlnSourceInstance = await getLastDeployedProxy("DlnSource", deployer);
  const dlnDestinationInstance = await getLastDeployedProxy("DlnDestination", deployer);

  console.log("dlnSourceInstance ", dlnSourceInstance.address);
  console.log("dlnDestinationInstance ", dlnDestinationInstance.address);

  const _dlnSourceAddress =  dlnSourceInstance.address;
  const _dlnDestinationAddress = dlnDestinationInstance.address;
  const chainIds = [1,56,137,250,42161,43114].filter(c=>c !=network.config.chainId);  

  let tx;
  for (const chainId of chainIds) {
    // setDlnSourceAddress(uint256 _chainIdFrom, bytes memory _dlnSourceAddress);
    console.log(`setDlnSourceAddress _chainIdFrom: ${chainId} _dlnSourceAddress: ${_dlnSourceAddress}`);
    tx = await dlnDestinationInstance.setDlnSourceAddress(chainId, _dlnSourceAddress, 1);
    await waitTx(tx);
    // setDlnDestinationAddress(uint256 _chainIdTo, bytes memory _dlnDestinationAddress)
    console.log(`setDlnDestinationAddress _chainIdTo: ${chainId} _dlnDestinationAddress: ${_dlnDestinationAddress}`);
    tx = await dlnSourceInstance.setDlnDestinationAddress(chainId, _dlnDestinationAddress, 1);
    await waitTx(tx);
  }

  const maxOrderCountPerBatchEvmUnlock = 10;
  const maxOrderCountPerBatchSolanaUnlock = 7;

  console.log(`Set setMaxOrderCountsPerBatch EVM: ${maxOrderCountPerBatchEvmUnlock}; SOL: ${maxOrderCountPerBatchSolanaUnlock}`);
  tx = await dlnDestinationInstance.setMaxOrderCountsPerBatch(maxOrderCountPerBatchEvmUnlock, maxOrderCountPerBatchSolanaUnlock);
  await waitTx(tx);
};

module.exports.tags = ['03_setup'];
// module.exports.dependencies = [''];

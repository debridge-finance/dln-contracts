const debridgeInitParams = require("../../assets/debridgeInitParams");
const { getLastDeployedProxy, deployProxy, waitTx } = require("../deploy-utils");

module.exports = async function ({ getNamedAccounts, deployments, network }) {
  const { deployer } = await getNamedAccounts();
  const deployInitParams = debridgeInitParams[network.name];
  if (!deployInitParams) return;
  
  let externalCallExecutorInstance = (await deployments.get("ExternalCallExecutor"));
  console.log(`ExternalCallExecutor ${externalCallExecutorInstance.address}`);

  const dlnDestinationInstance = await getLastDeployedProxy("DlnDestination", deployer);
  console.log("dlnDestinationInstance ", dlnDestinationInstance.address);
  
  // initialize(address _dlnDestination, address _executor)
  await deployProxy("DlnExternalCallAdapter", deployer,
  [
    dlnDestinationInstance.address,
    externalCallExecutorInstance.address
  ],
  true);
};

module.exports.tags = ['06_external_adapter'];
// module.exports.dependencies = [''];

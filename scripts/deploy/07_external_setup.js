const debridgeInitParams = require("../../assets/debridgeInitParams");
const { getLastDeployedProxy, waitTx } = require("../deploy-utils");

module.exports = async function ({ getNamedAccounts, deployments, network }) {
  const { deployer } = await getNamedAccounts();
  const deployInitParams = debridgeInitParams[network.name];
  if (!deployInitParams) return;
  
  const externalCallExecutorAddress = (await deployments.get("ExternalCallExecutor")).address;
  console.log(`ExternalCallExecutor ${externalCallExecutorAddress}`);

  const FactoryExternalCallExecutor = await hre.ethers.getContractFactory("ExternalCallExecutor", deployer);
  const externalCallExecutorInstance = await FactoryExternalCallExecutor.attach(externalCallExecutorAddress);

  const dlnDestinationInstance = await getLastDeployedProxy("DlnDestination", deployer);
  console.log("dlnDestinationInstance ", dlnDestinationInstance.address);
  
  const dlnExternalCallAdapterInstance = await getLastDeployedProxy("DlnExternalCallAdapter", deployer);
  console.log("DlnExternalCallAdapter ", dlnExternalCallAdapterInstance.address);

  console.log(`ExternalCallExecutor grantRole for adapter: `, dlnExternalCallAdapterInstance.address);
  const ADAPTER_ROLE = await externalCallExecutorInstance.ADAPTER_ROLE();
  console.log("ADAPTER_ROLE", ADAPTER_ROLE);
  let tx = await externalCallExecutorInstance.grantRole(ADAPTER_ROLE, dlnExternalCallAdapterInstance.address);
  await waitTx(tx);

  console.log(`DlnDestination setExternalCallAdapter: `, dlnExternalCallAdapterInstance.address);
  tx = await dlnDestinationInstance.setExternalCallAdapter(dlnExternalCallAdapterInstance.address);
  await waitTx(tx);
};

module.exports.tags = ['07_external_setup'];
// module.exports.dependencies = [''];

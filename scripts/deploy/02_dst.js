const debridgeInitParams = require("../../assets/debridgeInitParams");
const { deployProxy } = require("../deploy-utils");

module.exports = async function ({ getNamedAccounts, deployments, network }) {
  const { deployer } = await getNamedAccounts();
  const deployInitParams = debridgeInitParams[network.name];
  if (!deployInitParams) return;

  const deBridgeGateAddress = deployInitParams.deBridgeGateAddress;
  console.log("deBridgeGateInstance ", deBridgeGateAddress);
  const subscriptionId = deployInitParams.subscriptionId || 0;
  console.log("subscriptionId ", subscriptionId);

  // initialize(IDeBridgeGate _deBridgeGate)
  await deployProxy("DlnDestination", deployer,
    [
      deBridgeGateAddress,
      subscriptionId
    ],
    true);
};

module.exports.tags = ['02_dst'];
// module.exports.dependencies = [''];

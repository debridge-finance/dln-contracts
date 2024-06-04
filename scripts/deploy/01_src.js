const debridgeInitParams = require("../../assets/debridgeInitParams");
const { deployProxy } = require("../deploy-utils");

module.exports = async function ({ getNamedAccounts, deployments, network }) {
  const { deployer } = await getNamedAccounts();
  const deployInitParams = debridgeInitParams[network.name];
  if (!deployInitParams) return;

  console.log("deployer ", deployer);


  const deBridgeGateAddress = deployInitParams.deBridgeGateAddress;
  console.log("deBridgeGateInstance ", deBridgeGateAddress);
  const subscriptionId = deployInitParams.subscriptionId || 0;
  console.log("subscriptionId ", subscriptionId);
  
  // function initialize(
  //   IDeBridgeGate _deBridgeGate,
  //   uint256 _globalFixedNativeFee,
  //   uint16 _globalTransferFeeBps
  // )
  await deployProxy("DlnSource", deployer,
    [
      deBridgeGateAddress,
      deployInitParams.globalFixedNativeFee,
      deployInitParams.globalTransferFeeBps,
      subscriptionId
    ],
    true);
};

module.exports.tags = ['01_src'];
// module.exports.dependencies = [''];

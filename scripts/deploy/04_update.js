const debridgeInitParams = require("../../assets/debridgeInitParams");
const { upgradeProxy } = require("../deploy-utils");

module.exports = async function ({ getNamedAccounts, deployments, network }) {
  const { deployer } = await getNamedAccounts();
  const deployInitParams = debridgeInitParams[network.name];
  if (!deployInitParams) return;

  //  // 1. Upgrade DlnSource
  //  console.log('1. Upgrade DlnSource');
  //  await upgradeProxy(
  //    "DlnSource",
  //    "0x49f4b869Ca589120f6FC91e6D3D6009D7ecc69E5",
  //    deployer);

  // 1. Upgrade DlnDestination
  // console.log('2. Upgrade DlnDestination');
  // await upgradeProxy(
  //   "DlnDestination",
  //   "0xcc55C4088564EB34c8E91f7528C90EEE4C6A650C",
  //   deployer);
};

module.exports.tags = ['04_update'];
// module.exports.dependencies = [''];

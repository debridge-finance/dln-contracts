const debridgeInitParams = require("../../assets/debridgeInitParams");
const { upgradeProxy } = require("../deploy-utils");

module.exports = async function ({ getNamedAccounts, deployments, network }) {
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();
  await deploy("ExternalCallExecutor", {
    from: deployer,
    args: [],
    // deterministicDeployment: true,
    log: true,
  });
};

module.exports.tags = ['05_call_executor'];
// module.exports.dependencies = [''];

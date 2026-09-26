const AdaptiveRiskContract = artifacts.require("AdaptiveRiskContract");

module.exports = function (deployer) {
  deployer.deploy(AdaptiveRiskContract);
};

import * as helpers from "./helpers";
const constants = require("./constants");
const AbsoluteVote = artifacts.require("./AbsoluteVote.sol");
const GenericScheme = artifacts.require("./GenericScheme.sol");
const DaoCreator = artifacts.require("./DaoCreator.sol");
const ControllerCreator = artifacts.require("./ControllerCreator.sol");
const ERC20Mock = artifacts.require("./ERC20Mock.sol");
const ActionMock = artifacts.require("./ActionMock.sol");
const Wallet = artifacts.require("./Wallet.sol");

const PaymentToken = artifacts.require("StandaloneERC20");
const BondedToken = artifacts.require("BondedToken");
const BondingCurve = artifacts.require("BondingCurve");
const BancorCurveLogic = artifacts.require("BancorCurveLogic");
const StaticCurveLogic = artifacts.require("StaticCurveLogic");
const DividendPool = artifacts.require("DividendPool");

const BondingCurveFactory = artifacts.require("BondingCurveFactory");
const BancorCurveService = artifacts.require("BancorCurveService");

const { BN } = require("openzeppelin-test-helpers");

const { appCreate, getCurrentZosNetworkConfig } = require("./testHelpers");

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export class GenericSchemeParams {
  constructor() {}
}

const setupGenericSchemeParams = async function(
  genericScheme,
  accounts,
  contractToCall,
  genesisProtocol = false,
  tokenAddress = 0
) {
  var genericSchemeParams = new GenericSchemeParams();
  if (genesisProtocol === true) {
    genericSchemeParams.votingMachine = await helpers.setupGenesisProtocol(
      accounts,
      tokenAddress,
      0,
      helpers.NULL_ADDRESS
    );
    await genericScheme.setParameters(
      genericSchemeParams.votingMachine.params,
      genericSchemeParams.votingMachine.genesisProtocol.address,
      contractToCall
    );
    genericSchemeParams.paramsHash = await genericScheme.getParametersHash(
      genericSchemeParams.votingMachine.params,
      genericSchemeParams.votingMachine.genesisProtocol.address,
      contractToCall
    );
  } else {
    genericSchemeParams.votingMachine = await helpers.setupAbsoluteVote(
      helpers.NULL_ADDRESS,
      50,
      genericScheme.address
    );
    await genericScheme.setParameters(
      genericSchemeParams.votingMachine.params,
      genericSchemeParams.votingMachine.absoluteVote.address,
      contractToCall
    );
    genericSchemeParams.paramsHash = await genericScheme.getParametersHash(
      genericSchemeParams.votingMachine.params,
      genericSchemeParams.votingMachine.absoluteVote.address,
      contractToCall
    );
  }

  return genericSchemeParams;
};

const setup = async function(
  accounts,
  contractToCall = 0,
  reputationAccount = 0,
  genesisProtocol = false,
  tokenAddress = 0
) {
  var testSetup = new helpers.TestSetup();
  testSetup.standardTokenMock = await ERC20Mock.new(accounts[1], 100);
  testSetup.genericScheme = await GenericScheme.new();
  var controllerCreator = await ControllerCreator.new({
    gas: constants.ARC_GAS_LIMIT
  });
  testSetup.daoCreator = await DaoCreator.new(controllerCreator.address, {
    gas: constants.ARC_GAS_LIMIT
  });
  testSetup.reputationArray = [20, 10, 70];

  if (reputationAccount === 0) {
    testSetup.org = await helpers.setupOrganizationWithArrays(
      testSetup.daoCreator,
      [accounts[0], accounts[1], accounts[2]],
      [1000, 1000, 1000],
      testSetup.reputationArray
    );
  } else {
    testSetup.org = await helpers.setupOrganizationWithArrays(
      testSetup.daoCreator,
      [accounts[0], accounts[1], reputationAccount],
      [1000, 1000, 1000],
      testSetup.reputationArray
    );
  }
  testSetup.genericSchemeParams = await setupGenericSchemeParams(
    testSetup.genericScheme,
    accounts,
    contractToCall,
    genesisProtocol,
    tokenAddress
  );
  var permissions = "0x00000010";

  await testSetup.daoCreator.setSchemes(
    testSetup.org.avatar.address,
    [testSetup.genericScheme.address],
    [testSetup.genericSchemeParams.paramsHash],
    [permissions],
    "metaData"
  );

  return testSetup;
};

const createCallToActionMock = async function(_avatar, _actionMock) {
  return await new web3.eth.Contract(_actionMock.abi).methods
    .test2(_avatar)
    .encodeABI();
};

const encodeDeployCall = async function(deployParams, bondingCurveFactory) {
  return await new web3.eth.Contract(bondingCurveFactory.abi).methods
    .deploy([
      deployParams.owner,
      deployParams.beneficiary,
      deployParams.buyCurveParams,
      deployParams.sellCurveParams,
      deployParams.collateralToken,
      deployParams.splitOnPay,
      deployParams.bondedTokenName,
      deployParams.bondedTokenSymbol
    ])
    .encodeABI();
};

const encodeDeployBancorCall = async function(
  deployParams,
  bondingCurveFactory
) {
  return await new web3.eth.Contract(bondingCurveFactory.abi).methods
    .deployBancor([
      deployParams.owner,
      deployParams.beneficiary,
      deployParams.buyCurveParams,
      deployParams.sellCurveParams,
      deployParams.collateralToken,
      deployParams.splitOnPay,
      deployParams.bondedTokenName,
      deployParams.bondedTokenSymbol
    ])
    .encodeABI();
};

contract("genericScheme", function(accounts) {
  let actionMock;
  let factory;
  let paymentToken;
  let bancorCurveService;

  const tokenMinter = accounts[3];

  let deployParams = {
    owner: accounts[0],
    beneficiary: accounts[0],
    buyCurveParams: 10000,
    sellCurveParams: 1000,
    collateralToken: null,
    splitOnPay: 50,
    bondedTokenName: "BondedToken",
    bondedTokenSymbol: "BND"
  };

  const zosContracts = getCurrentZosNetworkConfig().contracts;

  const staticCurveLogicImpl = zosContracts.StaticCurveLogic.address;
  const bancorCurveLogicImpl = zosContracts.BancorCurveLogic.address;
  const bondedTokenImpl = zosContracts.BondedToken.address;
  const bondingCurveImpl = zosContracts.BondingCurve.address;
  const dividendPoolImpl = zosContracts.DividendPool.address;

  const tokenParams = {
    name: "PaymentToken",
    symbol: "PAY",
    decimals: new BN(18)
  };

  before(function() {
    helpers.etherForEveryone(accounts);
  });

  beforeEach(async function() {
    actionMock = await ActionMock.new();

    paymentToken = await PaymentToken.new();
    await paymentToken.initialize(
      tokenParams.name,
      tokenParams.symbol,
      tokenParams.decimals,
      new BN(web3.utils.toWei("60000", "ether")),
      tokenMinter,
      [tokenMinter],
      [tokenMinter]
    );

    deployParams.collateralToken = paymentToken.address;

    bancorCurveService = await BancorCurveService.at(
      await appCreate("bc-dao", "BancorCurveService", ZERO_ADDRESS, "0x")
    );

    await bancorCurveService.initialize();

    factory = await BondingCurveFactory.at(
      await appCreate("bc-dao", "BondingCurveFactory", ZERO_ADDRESS, "0x")
    );

    await factory.initialize(
      staticCurveLogicImpl,
      bancorCurveLogicImpl,
      bondedTokenImpl,
      bondingCurveImpl,
      dividendPoolImpl,
      bancorCurveService.address
    );
  });

  it("setParameters", async function() {
    var genericScheme = await GenericScheme.new();
    var absoluteVote = await AbsoluteVote.new();
    await genericScheme.setParameters(
      "0x1234",
      absoluteVote.address,
      accounts[0]
    );
    var paramHash = await genericScheme.getParametersHash(
      "0x1234",
      absoluteVote.address,
      accounts[0]
    );
    var parameters = await genericScheme.parameters(paramHash);
    assert.equal(parameters[0], absoluteVote.address);
    assert.equal(parameters[2], accounts[0]);
  });

  it("proposeCall log", async function() {
    var testSetup = await setup(accounts, factory.address);

    deployParams.owner = testSetup.org.avatar.address;
    deployParams.beneficiary = testSetup.org.avatar.address;

    var callData = await encodeDeployBancorCall(deployParams, factory);

    var tx = await testSetup.genericScheme.proposeCall(
      testSetup.org.avatar.address,
      callData,
      0,
      helpers.NULL_HASH
    );
    assert.equal(tx.logs.length, 1);
    assert.equal(tx.logs[0].event, "NewCallProposal");
  });

  it("execute proposeCall -no decision - proposal data delete", async function() {
    var testSetup = await setup(accounts, factory.address);

    deployParams.owner = testSetup.org.avatar.address;
    deployParams.beneficiary = testSetup.org.avatar.address;

    var callData = await encodeDeployBancorCall(deployParams, factory);

    var tx = await testSetup.genericScheme.proposeCall(
      testSetup.org.avatar.address,
      callData,
      0,
      helpers.NULL_HASH
    );
    var proposalId = await helpers.getValueFromLogs(tx, "_proposalId");
    await testSetup.genericSchemeParams.votingMachine.absoluteVote.vote(
      proposalId,
      0,
      0,
      helpers.NULL_ADDRESS,
      { from: accounts[2] }
    );
    //check organizationsProposals after execution
    var organizationProposal = await testSetup.genericScheme.organizationsProposals(
      testSetup.org.avatar.address,
      proposalId
    );
    assert.equal(organizationProposal.passed, false);
    assert.equal(organizationProposal.callData, null);
  });

  it("execute proposeVote -positive decision - proposal data delete", async function() {
    var testSetup = await setup(accounts, factory.address);

    deployParams.owner = testSetup.org.avatar.address;
    deployParams.beneficiary = testSetup.org.avatar.address;

    var callData = await encodeDeployBancorCall(deployParams, factory);

    var tx = await testSetup.genericScheme.proposeCall(
      testSetup.org.avatar.address,
      callData,
      0,
      helpers.NULL_HASH
    );
    var proposalId = await helpers.getValueFromLogs(tx, "_proposalId");
    var organizationProposal = await testSetup.genericScheme.organizationsProposals(
      testSetup.org.avatar.address,
      proposalId
    );
    assert.equal(organizationProposal[0], callData, helpers.NULL_HASH);
    await testSetup.genericSchemeParams.votingMachine.absoluteVote.vote(
      proposalId,
      1,
      0,
      helpers.NULL_ADDRESS,
      { from: accounts[2] }
    );

    //check organizationsProposals after execution
    organizationProposal = await testSetup.genericScheme.organizationsProposals(
      testSetup.org.avatar.address,
      proposalId
    );
    assert.equal(organizationProposal.callData, null); //new contract address
  });

  it("execute should fail if not executed from votingMachine", async function() {
    var testSetup = await setup(accounts, factory.address);

    deployParams.owner = testSetup.org.avatar.address;
    deployParams.beneficiary = testSetup.org.avatar.address;

    var encodeABI = await encodeDeployBancorCall(deployParams, factory);

    var tx = await testSetup.genericScheme.proposeCall(
      testSetup.org.avatar.address,
      encodeABI,
      0,
      helpers.NULL_HASH
    );
    var proposalId = await helpers.getValueFromLogs(tx, "_proposalId");

    try {
      await testSetup.genericScheme.execute(
        testSetup.org.avatar.address,
        proposalId
      );
      assert(false, "execute should fail if not executed from votingMachine");
    } catch (error) {
      helpers.assertVMException(error);
    }
  });
});

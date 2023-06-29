
const fs = require("fs");
const commandLineArgs = require('command-line-args');
const commandLineUsage = require('command-line-usage');
const RLP = require('rlp');
const Web3 = require('web3');
const EthTx = require('@ethereumjs/tx');
const EthCom = require('@ethereumjs/common');
const EthUtil = require('ethereumjs-util');
const EthWallet = require('ethereumjs-wallet');

const distributorContract = require("../Contracts/Distributor.json");

const optionDefinitions = [
  {
    name: 'help',
    description: 'Display this usage guide.',
    alias: 'h',
    type: Boolean
  },
  {
    name: 'verbose',
    description: 'Run the script with verbose output',
    alias: 'v',
    type: Boolean,
  },
  {
    name: 'fundings',
    description: 'The list of fundings (list of address:amount lines)',
    alias: 'f',
    type: String,
    typeLabel: '{underline fundings.txt}'
  },
  {
    name: 'fundings-js',
    description: 'A js file that returns a list of fundings on execution',
    alias: 'j',
    type: String,
    typeLabel: '{underline fundings.js}'
  },
  {
    name: 'rpchost',
    description: 'The RPC host to send transactions to.',
    alias: 'r',
    type: String,
    typeLabel: '{underline http://127.0.0.1:8545}',
    defaultValue: 'http://127.0.0.1:8545'
  },
  {
    name: 'privkey',
    description: 'The private key of the wallet to send funds from.\n(Special: "env" to read from FUNDINGTOOL_PRIVKEY environment variable)',
    alias: 'p',
    type: String,
    typeLabel: '{underline privkey}',
  },
  {
    name: 'random-privkey',
    description: 'Use random private key if no privkey supplied',
    type: Boolean,
  },
  {
    name: 'maxpending',
    description: 'The maximum number of parallel pending transactions.',
    alias: 'm',
    type: Number,
    typeLabel: '{underline 10}',
    defaultValue: 10,
  },
  {
    name: 'gaslimit',
    description: 'The gas limit for transactions.',
    type: Number,
    typeLabel: '{underline 500000}',
    defaultValue: 500000,
  },
  {
    name: 'maxfeepergas',
    description: 'The maximum fee per gas in gwei.',
    type: Number,
    typeLabel: '{underline 20}',
    defaultValue: 20,
  },
  {
    name: 'maxpriofee',
    description: 'The maximum priority fee per gas in gwei.',
    type: Number,
    typeLabel: '{underline 1.2}',
    defaultValue: 1.2,
  },
  {
    name: 'use-distributor',
    description: 'Use a distribution contract.',
    type: Boolean,
  },
  {
    name: 'distributor-batch-size',
    description: 'The max size of transaction batches to send via the distributor contract.',
    type: Number,
    typeLabel: '{underline 20}',
    defaultValue: 20,
  },
  {
    name: 'output',
    description: 'Output signed transactions to file instead of broadcasting them (offline mode).',
    alias: 'o',
    type: String,
    typeLabel: '{underline txlist.txt}',
  },
  {
    name: 'summary',
    description: 'Output summary of distribution to file.',
    type: String,
    typeLabel: '{underline summary.txt}',
  },
  {
    name: 'chainid',
    description: 'ChainID of the network (For offline mode in combination with --output)',
    type: Number,
    typeLabel: '{underline 5}',
  },
  {
    name: 'nonce',
    description: 'Current nonce of the wallet (For offline mode in combination with --output)',
    type: Number,
    typeLabel: '{underline 0}',
    defaultValue: 0,
  },
];
const options = commandLineArgs(optionDefinitions);

var web3 = null;
var web3Common = null;
var wallet = null;
var fundings = [];
var pendingQueue = [];
var distributor = null;
var stats = {
  transferCount: 0,
  transactionCount: 0,
  totalAmount: BigInt(0),
};

main();

async function main() {
  if(options['help']) {
    printHelp();
    return;
  }

  var walletKey = loadPrivateKey();
  if(!walletKey) {
    printHelp();
    console.log("No wallet privkey specified.");
    console.log("");
    return;
  }

  var walletAddr = EthUtil.toChecksumAddress("0x"+EthUtil.privateToAddress(walletKey).toString("hex"));
  wallet = {
    privkey: walletKey,
    addr: walletAddr,
  };

  if(options['fundings']) {
    var fundingList = fs.readFileSync(options['fundings'], "utf8").split("\n");
    loadFundingFile(fundings, fundingList);
  }
  if(options['fundings-js']) {
    var fundingsJsCode = fs.readFileSync(options['fundings-js'], "utf8");
    var fundingsJsRes = eval(fundingsJsCode);
    if(typeof fundingsJsRes === "function")
      fundingsJsRes = fundingsJsRes();
    if(fundingsJsRes && typeof fundingsJsRes.then === "function")
      fundingsJsRes = await fundingsJsRes;

    for(var i = 0; i < fundingsJsRes.length; i++) {
      fundings.push(fundingsJsRes[i]);
    }
  }
  
  if(!fundings || fundings.length == 0) {
    printHelp();
    console.log("No fundings specified.");
    console.log("");
    return;
  }

  if(options['output'] && fs.existsSync(options['output'])) {
    fs.unlinkSync(options['output']);
  }

  if(options['output'] && options['chainid']) {
    // use in offline mode
    web3 = new Web3();
    wallet.offline = true;
    wallet.chainid = options['chainid'];
    wallet.nonce = options['nonce'];
  }
  else {
    await startWeb3();
  }
  initWeb3Chain(wallet.chainid);
  await initDistributor();
  await processFundings();
  await Promise.all(pendingQueue.map((entry) => entry.promise));

  console.log("fundings complete!");

  if(options['summary']) {
    let summary = [
      "WalletAddress: " + wallet.addr,
      "TotalAmountWei: " + stats.totalAmount.toString(),
      "TotalAmountEth: " + weiToEth(stats.totalAmount),
      "TransactionCount: " + stats.transactionCount,
    ];
    if(distributor) {
      summary.push("TransferCount: " + stats.transferCount);
      summary.push("DistributorAddr: " + distributor.addr);
    }
    
    fs.writeFileSync(options['summary'], summary.join("\n"));
  }
}

function printHelp() {
  console.log(commandLineUsage([
    {
      header: 'Testnet Funding Tool',
      content: 'A simple tool that sends funds to the specified accounts.'
    },
    {
      header: 'Options',
      optionList: optionDefinitions
    }
  ]));
}

function sleepPromise(timeout) {
  return new Promise((resolve) => {
    setTimeout(resolve, timeout);
  })
}

function weiToEth(wei) {
  return parseInt((wei / 1000000000000000n).toString()) / 1000;
}

function loadPrivateKey() {
  if(options['privkey'] === "env" && (process.env.FUNDINGTOOL_PRIVKEY || "").match(/^[0-9a-f]{64}$/i)) {
    return Buffer.from(process.env.FUNDINGTOOL_PRIVKEY, "hex");
  }
  if(options['privkey'] && options['privkey'].match(/^[0-9a-f]{64}$/i)) {
    return Buffer.from(options['privkey'], "hex");
  }
  if(options['random-privkey']) {
    let wallet = EthWallet.default.generate();
    return Buffer.from(wallet.getPrivateKeyString().replace(/^0x/, ""), "hex");
  }
  
  return null;
}

function loadFundingFile(resArray, fundingList) {
  var fundingLine, cmtPos, fundingEntry;
  for(var i = 0; i < fundingList.length; i++) {
    fundingLine = fundingList[i];
    if((cmtPos = fundingLine.indexOf("#")) !== -1)
      fundingLine = fundingLine.substring(0, cmtPos);
    fundingEntry = fundingLine.trim().split(":");
    if(fundingEntry.length < 2)
      continue;
    resArray.push({
      address: fundingEntry[0].trim(),
      amount: BigInt(fundingEntry[1].replace(/[ \t]*ETH/i, "000000000000000000").replace(/[ \t]*gwei/i, "000000000").trim()),
    });
  }
}

async function startWeb3() {
  try {
    console.log("connecting to web3 rpc: " + options['rpchost']);
    var web3Provider = new Web3.providers.HttpProvider(options['rpchost']);
    web3 = new Web3(web3Provider);
    
    var res = await Promise.all([
      web3.eth.getChainId(),
      web3.eth.getBalance(wallet.addr),
      web3.eth.getTransactionCount(wallet.addr)
    ]);
    wallet.chainid = res[0];
    wallet.balance = BigInt(res[1]);
    wallet.nonce = res[2];
    console.log("wallet " + wallet.addr + " balance: " + weiToEth(wallet.balance) + " ETH [nonce: " + wallet.nonce + "]");
  } catch(ex) {
    console.error("web3 exception: ", ex);
    await sleepPromise(5000);
    await startWeb3();
  }
}

function initWeb3Chain(chainid) {
  console.log("initialize web3 with chainid " + chainid);
  web3Common = EthCom.default.forCustomChain('mainnet', {
    networkId: chainid,
    chainId: chainid,
  }, 'london');
}

async function initDistributor() {
  if(options['use-distributor']) {
    var distributorAddr = await deployDistributor();
    console.log("enabled distributor contract: " + distributorAddr);
    distributor = {
      addr: distributorAddr,
      contract: new web3.eth.Contract(distributorContract.abi, distributorAddr),
    };
  }
}

async function processFundings() {
  try {
    let distrCount;
    let lastLogTime = 0;
    let totalCount = fundings.length;

    while(fundings.length > 0) {
      if(pendingQueue.length >= options['maxpending']) {
        await sleepPromise(2000);
        continue;
      }

      if(distributor) {
        distrCount = fundings.length;
        if(distrCount > options['distributor-batch-size'])
          distrCount = options['distributor-batch-size'];
        
        await processFundingBatch(fundings.slice(0, distrCount));
        fundings.splice(0, distrCount);
      }
      else {
        await processFunding(fundings[0].address, fundings[0].amount);
        fundings.shift();
      }

      let now = (new Date()).getTime();
      if(now - lastLogTime >= 5000) {
        console.log("distributing... progress: " + stats.transferCount + " / " + totalCount);
        lastLogTime = now;
      }
    }
  } catch(ex) {
    console.error("funding loop exception: ", ex);
    await sleepPromise(5000);
    await processFundings();
  }
}

async function processFunding(address, amount) {
  if(options['verbose'])
    console.log("process funding " + address + ":  " + weiToEth(amount) + " ETH");

  if(amount > wallet.balance && !wallet.offline) {
    console.log("  amount exceeds wallet balance (" + weiToEth(wallet.balance) + " ETH)");
    return;
  }

  var txhex = buildEthTx(address, amount, wallet.nonce);
  var txres = await publishTransaction(txhex);
  if(options['verbose'])
    console.log("  tx hash: " + txres[0]);

  stats.transferCount++;
  stats.transactionCount++;
  stats.totalAmount += amount;

  var txobj = {
    nonce: wallet.nonce,
    hash: txres[0],
    hex: txhex,
    promise: txres[1],
  };
  wallet.nonce++;
  if(!wallet.offline)
    wallet.balance -= amount;
  pendingQueue.push(txobj);

  txres[1].then(() => {
    let txobjIdx = pendingQueue.indexOf(txobj);
    if(txobjIdx > -1)
      pendingQueue.splice(txobjIdx, 1);
  }, (err) => {
    console.error("tx [" + txres[0] + "] error: ", err);
  })
}

function buildEthTx(to, amount, nonce) {
  var rawTx = {
    nonce: nonce,
    gasLimit: options['gaslimit'],
    maxPriorityFeePerGas: options['maxpriofee'] * 1000000000,
    maxFeePerGas: options['maxfeepergas'] * 1000000000,
    from: wallet.addr,
    to: to,
    value: "0x" + amount.toString(16)
  };
  var privateKey = Uint8Array.from(wallet.privkey);
  var tx = EthTx.FeeMarketEIP1559Transaction.fromTxData(rawTx, { common: web3Common });
  tx = tx.sign(privateKey);

  var txRes = tx.serialize().toString('hex');
  return txRes;
}

async function publishTransaction(txhex) {
  if(options['output']) {
    // redirect to file
    return outputTransaction(txhex);
  }
  else {
    // send transaction
    return sendTransaction(txhex);
  }
}

async function sendTransaction(txhex) {
  var txhashResolve, txhashReject;
  var txhashPromise = new Promise((resolve, reject) => {txhashResolve = resolve; txhashReject = reject; });
  var receiptResolve, receiptReject;
  var receiptPromise = new Promise((resolve, reject) => {receiptResolve = resolve; receiptReject = reject; });
  var txStatus = 0;

  var txPromise = web3.eth.sendSignedTransaction("0x" + txhex);
  txPromise.once('transactionHash', (hash) => {
    txStatus = 1;
    txhashResolve(hash);
  });
  txPromise.once('receipt', (receipt) => {
    txStatus = 2;
    receiptResolve(receipt);
  });
  txPromise.on('error', (error) => {
    if(txStatus === 0)
      txhashReject(error);
    else
      receiptReject(error);
  });

  let txHash = await txhashPromise;
  return [txHash, receiptPromise];
}

async function outputTransaction(txhex) {
  fs.appendFileSync(options['output'], "0x" + txhex + "\n");
  let txHash = "0x" + EthUtil.keccak256(Buffer.from(txhex, "hex")).toString("hex");
  return [txHash, Promise.resolve()];
}


async function deployDistributor() {
  var distributorStateFile = "distributor-state.json";
  var distributorState;
  if(fs.existsSync(distributorStateFile))
    distributorState = JSON.parse(fs.readFileSync(distributorStateFile, "utf8"));
  else
    distributorState = {};

  if(distributorState.contractAddr && !wallet.offline) {
    var code = await web3.eth.getCode(distributorState.contractAddr);
    if(code == "0x"+distributorContract.deployed)
      return distributorState.contractAddr;
  }

  stats.transactionCount++;

  var nonce = wallet.nonce;
  var rawTx = {
    nonce: nonce,
    gasLimit: options['gaslimit'],
    maxPriorityFeePerGas: options['maxpriofee'] * 1000000000,
    maxFeePerGas: options['maxfeepergas'] * 1000000000,
    from: wallet.addr,
    to: null,
    value: 0,
    data: Buffer.from(distributorContract.bytecode, "hex"),
  };
  var privateKey = Uint8Array.from(wallet.privkey);
  var tx = EthTx.FeeMarketEIP1559Transaction.fromTxData(rawTx, { common: web3Common });
  tx = tx.sign(privateKey);
  var txhex = tx.serialize().toString('hex');

  var txres = await publishTransaction(txhex);
  wallet.nonce++;
  console.log("deploying distributor contract (tx: " + txres[0] + ")");

  var deployEnc = Buffer.from(RLP.encode([wallet.addr, nonce]));
  var deployHash = web3.utils.sha3(deployEnc);
  var deployAddr = web3.utils.toChecksumAddress("0x"+deployHash.substring(26));

  distributorState.contractAddr = deployAddr;
  fs.writeFileSync(distributorStateFile, JSON.stringify(distributorState));

  return deployAddr;
}

async function processFundingBatch(batch) {
  var totalAmount = BigInt(0);
  var amountsDict = {};
  batch.forEach((entry) => {
    if(options['verbose'])
      console.log("process funding " + entry.address + ":  " + weiToEth(entry.amount) + " ETH");
    totalAmount += entry.amount;
    stats.transferCount++;
    amountsDict[entry.amount] = true;
  });

  if(totalAmount > wallet.balance && !wallet.offline) {
    console.log("  batch size (" + weiToEth(totalAmount) + " ETH) exceeds wallet balance (" + weiToEth(wallet.balance) + " ETH)");
    return;
  }

  var callData = null;
  var addrs = Buffer.concat(batch.map((e) => Buffer.from(e.address.replace(/^0x/i, ""), "hex")));
  if(Object.keys(amountsDict).length === 1) {
    // all same amount, use distributeEqual(bytes calldata addrs)
    callData = distributor.contract.methods.distributeEqual(addrs).encodeABI();
  } else if(Object.keys(amountsDict).filter(a => (BigInt(a) % 1000000000000000000n) === 0n).length === 0) {
    // only full ether amounts, use distributeEther(bytes calldata addrs, uint32[] calldata values)
    callData = distributor.contract.methods.distributeEther(addrs, batch.map((e) => e.amount / 1000000000000000000n)).encodeABI();
  } else if(Object.keys(amountsDict).filter(a => (BigInt(a) % 1000000000n) === 0n).length === 0) {
    // only full gwei amounts, use distributeGwei(bytes calldata addrs, uint64[] calldata values)
    callData = distributor.contract.methods.distributeGwei(addrs, batch.map((e) => e.amount / 1000000000n)).encodeABI();
  } else {
    // use distribute(bytes calldata addrs, uint256[] calldata values)
    callData = distributor.contract.methods.distributeGwei(addrs, batch.map((e) => e.amount)).encodeABI();
  }

  var nonce = wallet.nonce;
  var rawTx = {
    nonce: nonce,
    gasLimit: options['gaslimit'],
    maxPriorityFeePerGas: options['maxpriofee'] * 1000000000,
    maxFeePerGas: options['maxfeepergas'] * 1000000000,
    from: wallet.addr,
    to: distributor.addr,
    value: "0x" + totalAmount.toString(16),
    data: callData
  };

  var privateKey = Uint8Array.from(wallet.privkey);
  var tx = EthTx.FeeMarketEIP1559Transaction.fromTxData(rawTx, { common: web3Common });
  tx = tx.sign(privateKey);

  var txhex = tx.serialize().toString('hex');
  var txres = await publishTransaction(txhex);
  if(options['verbose'])
    console.log("  tx hash: " + txres[0]);

  stats.transactionCount++;
  stats.totalAmount += totalAmount;

  var txobj = {
    nonce: nonce,
    hash: txres[0],
    hex: txhex,
    promise: txres[1],
  };
  wallet.nonce++;
  if(!wallet.offline)
    wallet.balance -= totalAmount;
  pendingQueue.push(txobj);

  txres[1].then(() => {
    let txobjIdx = pendingQueue.indexOf(txobj);
    if(txobjIdx > -1)
      pendingQueue.splice(txobjIdx, 1);
  }, (err) => {
    console.error("tx [" + txres[0] + "] error: ", err);
  })
}

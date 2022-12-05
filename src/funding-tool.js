
const fs = require("fs");
const commandLineArgs = require('command-line-args');
const commandLineUsage = require('command-line-usage');
const Web3 = require('web3');
const EthTx = require('@ethereumjs/tx');
const EthCom = require('@ethereumjs/common');
const EthUtil = require('ethereumjs-util');

const optionDefinitions = [
  {
    name: 'help',
    description: 'Display this usage guide.',
    alias: 'h',
    type: Boolean
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
    description: 'The private key of the wallet to send funds from.',
    alias: 'p',
    type: String,
    typeLabel: '{underline privkey}',
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
];
const options = commandLineArgs(optionDefinitions);

var web3 = null;
var web3Common = null;
var wallet = null;
var fundings;
var pendingQueue = [];

main();

async function main() {
  if(options['help']) {
    printHelp();
    return;
  }

  if(!options['privkey']) {
    printHelp();
    console.log("No wallet privkey specified.");
    console.log("");
    return;
  }

  var walletKey = Buffer.from(options['privkey'], "hex");
  var walletAddr = EthUtil.toChecksumAddress("0x"+EthUtil.privateToAddress(walletKey).toString("hex"));
  wallet = {
    privkey: walletKey,
    addr: walletAddr,
  };

  if(options['fundings']) {
    var fundingList = fs.readFileSync(options['fundings'], "utf8");
    fundings = fundingList.split("\n").map((fundingLine) => {
      let fundingEntry = fundingLine.split(":");
      if(fundingEntry.length < 2)
        return;
      return {
        address: fundingEntry[0],
        amount: BigInt(fundingEntry[1])
      };
    }).filter((entry) => !!entry);
  }
  else if(options['fundings-js']) {
    var fundingsJsCode = fs.readFileSync(options['fundings-js'], "utf8");
    var fundingsJsRes = eval(fundingsJsCode);
    if(typeof fundingsJsRes === "function")
      fundingsJsRes = fundingsJsRes();
    if(fundingsJsRes && typeof fundingsJsRes.then === "function")
      fundingsJsRes = await fundingsJsRes;
    fundings = fundingsJsRes;
  }
  
  if(!fundings || fundings.length == 0) {
    printHelp();
    console.log("No fundings specified.");
    console.log("");
    return;
  }

  await startWeb3();
  await processFundings();
  await Promise.all(pendingQueue.map((entry) => entry.promise));

  console.log("fundings complete!");
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

    console.log("initialize web3 with chainid " + wallet.chainid);
    web3Common = EthCom.default.forCustomChain('mainnet', {
      networkId: wallet.chainid,
      chainId: wallet.chainid,
    }, 'london');

    wallet.balance = BigInt(res[1]);
    wallet.nonce = res[2];
    console.log("wallet " + wallet.addr + " balance: " + weiToEth(wallet.balance) + " ETH [nonce: " + wallet.nonce + "]");
    

  } catch(ex) {
    console.error("web3 exception: ", ex);
    await sleepPromise(5000);
    await startWeb3();
  }
}

async function processFundings() {
  try {
    while(fundings.length > 0) {
      if(pendingQueue.length >= options['maxpending']) {
        await sleepPromise(2000);
        continue;
      }

      await processFunding(fundings[0].address, fundings[0].amount);
      fundings.shift();
    }
  } catch(ex) {
    console.error("funding loop exception: ", ex);
    await sleepPromise(5000);
    await processFundings();
  }
}

async function processFunding(address, amount) {
  console.log("process funding " + address + ":  " + weiToEth(amount) + " ETH");

  if(amount > wallet.balance) {
    console.log("  amount exceeds wallet balance (" + weiToEth(wallet.balance) + " ETH)");
    return;
  }

  var txhex = buildEthTx(address, amount, wallet.nonce);
  var txres = await sendTransaction(txhex);
  console.log("  tx hash: " + txres[0]);

  var txobj = {
    nonce: wallet.nonce,
    hash: txres[0],
    hex: txhex,
    promise: txres[1],
  };
  wallet.nonce++;
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
    gasLimit: 50000,
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

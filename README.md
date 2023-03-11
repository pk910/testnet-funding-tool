# Testnet Funding Tool

  A simple tool that sends funds to the specified accounts.

# Options
```
  -h, --help                            Display this usage guide.
  -v, --verbose                         Run the script with verbose output
  -f, --fundings fundings.txt           The list of fundings (list of address:amount lines)
  -j, --fundings-js fundings.js         A js file that returns a list of fundings on execution
  -r, --rpchost http://127.0.0.1:8545   The RPC host to send transactions to.
  -p, --privkey privkey                 The private key of the wallet to send funds from.
                                        (Special: "env" to read from FUNDINGTOOL_PRIVKEY environment variable)
  --random-privkey                      Use random private key if no privkey supplied
  -m, --maxpending 10                   The maximum number of parallel pending transactions.
  --gaslimit 500000                     The gas limit for transactions.
  --maxfeepergas 20                     The maximum fee per gas in gwei.
  --maxpriofee 1.2                      The maximum priority fee per gas in gwei.
  --use-distributor                     Use a distribution contract.
  --distributor-batch-size 20           The max size of transaction batches to send via the distributor contract.
  -o, --output txlist.txt               Output signed transactions to file instead of broadcasting them (offline
                                        mode).
  --summary summary.txt                 Output summary of distribution to file.
  --chainid 5                           ChainID of the network (For offline mode in combination with --output)
  --nonce 0                             Current nonce of the wallet (For offline mode in combination with --output)
```

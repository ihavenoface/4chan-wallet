// @ts-nocheck
const bitcoin = require('bitcoinjs-lib');
const reverse = require('buffer-reverse');
const BigNumber = require('bignumber.js');
import { LegacyWallet, SegwitBech32Wallet, SegwitP2SHWallet } from '../class';
import g from "~src/store/env";

let disableBatching = false;

let latestBlockheight = false;
let latestBlockheightTimestamp = false;

const txhashHeightCache = {}; // we might have this in the client / api

const multiGetHistoryByAddress = async function (addresses, batchsize=100) {
    if (!g.state?.client) throw '';
    const ret = {};

    const chunks = splitIntoChunks(addresses, batchsize);
    for (const chunk of chunks) {
        const scripthashes = [];
        const scripthash2addr = {};
        for (const addr of chunk) {
            const script = bitcoin.address.toOutputScript(addr);
            const hash = bitcoin.crypto.sha256(script);
            let reversedHash = Buffer.from(reverse(hash));
            reversedHash = reversedHash.toString('hex');
            scripthashes.push(reversedHash);
            scripthash2addr[reversedHash] = addr;
        }

        let results = [];

        if (disableBatching) {
            const promises = [];
            const index2scripthash = {};
            for (let promiseIndex = 0; promiseIndex < scripthashes.length; promiseIndex++) {
                index2scripthash[promiseIndex] = scripthashes[promiseIndex];
                promises.push(g.state?.client.blockchainScripthash_getHistory(scripthashes[promiseIndex]));
            }
            const histories = await Promise.all(promises);
            for (let historyIndex = 0; historyIndex < histories.length; historyIndex++) {
                results.push({ result: histories[historyIndex], param: index2scripthash[historyIndex] });
            }
        } else {
            results = await g.state?.client.blockchainScripthash_getHistoryBatch(scripthashes);
        }

        for (const history of results) {
            if (history.error) console.warn('multiGetHistoryByAddress():', history.error);
            ret[scripthash2addr[history.param]] = history.result || [];
            for (const result of history.result || []) {
                if (result.tx_hash) txhashHeightCache[result.tx_hash] = result.height; // cache tx height
            }

            for (const hist of ret[scripthash2addr[history.param]]) {
                hist.address = scripthash2addr[history.param];
            }
        }
    }

    return ret;
};

const multiGetTransactionByTxid = async function (txids, batchsize=45, verbose = true) {
    // this value is fine-tuned so althrough wallets in test suite will occasionally
    // throw 'response too large (over 1,000,000 bytes', test suite will pass
    if (!g.state?.client) throw '';
    const ret = {};
    txids = [...new Set(txids)]; // deduplicate just for any case

    // lets try cache first:
    let cache = JSON.parse(await GM_getValue('tx_cache', '{}'));
    if (Object.keys(cache).length > 10000)
        cache = {};
    const cacheKeySuffix = verbose ? '_verbose' : '_non_verbose';
    const keysCacheMiss = [];
    for (const txid of txids) {
        if (cache[txid + cacheKeySuffix]) {
            ret[txid] = cache[txid + cacheKeySuffix];
        }
        if (!ret[txid]) keysCacheMiss.push(txid);
    }
    if (keysCacheMiss.length === 0) {
        return ret;
    }

    txids = keysCacheMiss;
    // end cache

    const chunks = splitIntoChunks(txids, batchsize);
    for (const chunk of chunks) {
        let results = [];

        if (disableBatching) {
            try {
                // in case of ElectrumPersonalServer it might not track some transactions (like source transactions for our transactions)
                // so we wrap it in try-catch. note, when `Promise.all` fails we will get _zero_ results, but we have a fallback for that
                const promises = [];
                const index2txid = {};
                for (let promiseIndex = 0; promiseIndex < chunk.length; promiseIndex++) {
                    const txid = chunk[promiseIndex];
                    index2txid[promiseIndex] = txid;
                    promises.push(g.state?.client.blockchainTransaction_get(txid, verbose));
                }

                const transactionResults = await Promise.all(promises);
                for (let resultIndex = 0; resultIndex < transactionResults.length; resultIndex++) {
                    let tx = transactionResults[resultIndex];
                    if (typeof tx === 'string' && verbose) {
                        // apparently electrum server (EPS?) didnt recognize VERBOSE parameter, and  sent us plain txhex instead of decoded tx.
                        // lets decode it manually on our end then:
                        tx = txhexToElectrumTransaction(tx);
                    }
                    const txid = index2txid[resultIndex];
                    results.push({ result: tx, param: txid });
                }
            } catch (_) {
                // fallback. pretty sure we are connected to EPS.  we try getting transactions one-by-one. this way we wont
                // fail and only non-tracked by EPS transactions will be omitted
                for (const txid of chunk) {
                    try {
                        let tx = await g.state?.client.blockchainTransaction_get(txid, verbose);
                        if (typeof tx === 'string' && verbose) {
                            // apparently electrum server (EPS?) didnt recognize VERBOSE parameter, and  sent us plain txhex instead of decoded tx.
                            // lets decode it manually on our end then:
                            tx = txhexToElectrumTransaction(tx);
                        }
                        results.push({ result: tx, param: txid });
                    } catch (_) {}
                }
            }
        } else {
            results = await g.state?.client.blockchainTransaction_getBatch(chunk, verbose);
        }

        for (const txdata of results) {
            if (txdata.error && txdata.error.code === -32600) {
                // response too large
                // lets do single call, that should go through okay:
                txdata.result = await g.state?.client.blockchainTransaction_get(txdata.param, verbose);
            }
            ret[txdata.param] = txdata.result;
            if (ret[txdata.param]) delete ret[txdata.param].hex; // compact
        }
    }

    for (const txid of Object.keys(ret)) {
        if (verbose && (!ret[txid].confirmations || ret[txid].confirmations < 7)) continue;
        cache[txid + cacheKeySuffix] = ret[txid];
    }
    GM_setValue('txcache', JSON.stringify(cache));

    return ret;
};

const multiGetBalanceByAddress = async function (addresses, batchsize=200) {
    if (!g.state?.client) throw '';
    const ret = { balance: 0, unconfirmed_balance: 0, addresses: {} };

    const chunks = splitIntoChunks(addresses, batchsize);
    for (const chunk of chunks) {
        const scripthashes = [];
        const scripthash2addr = {};
        for (const addr of chunk) {
            const script = bitcoin.address.toOutputScript(addr);
            const hash = bitcoin.crypto.sha256(script);
            let reversedHash = Buffer.from(reverse(hash));
            reversedHash = reversedHash.toString('hex');
            scripthashes.push(reversedHash);
            scripthash2addr[reversedHash] = addr;
        }

        let balances = [];

        if (disableBatching) {
            const promises = [];
            const index2scripthash = {};
            for (let promiseIndex = 0; promiseIndex < scripthashes.length; promiseIndex++) {
                promises.push(g.state?.client.blockchainScripthash_getBalance(scripthashes[promiseIndex]));
                index2scripthash[promiseIndex] = scripthashes[promiseIndex];
            }
            const promiseResults = await Promise.all(promises);
            for (let resultIndex = 0; resultIndex < promiseResults.length; resultIndex++) {
                balances.push({ result: promiseResults[resultIndex], param: index2scripthash[resultIndex] });
            }
        } else {
            balances = await g.state?.client.blockchainScripthash_getBalanceBatch(scripthashes);
        }

        for (const bal of balances) {
            if (bal.error) console.warn('multiGetBalanceByAddress():', bal.error);
            ret.balance += +bal.result.confirmed;
            ret.unconfirmed_balance += +bal.result.unconfirmed;
            ret.addresses[scripthash2addr[bal.param]] = bal.result;
        }
    }

    return ret;
};

const multiGetUtxoByAddress = async function (addresses, batchsize=100) {
    if (!g.state?.client) throw '';
    const ret = {};

    const chunks = splitIntoChunks(addresses, batchsize);
    for (const chunk of chunks) {
        const scripthashes = [];
        const scripthash2addr = {};
        for (const addr of chunk) {
            const script = bitcoin.address.toOutputScript(addr);
            const hash = bitcoin.crypto.sha256(script);
            let reversedHash = Buffer.from(reverse(hash));
            reversedHash = reversedHash.toString('hex');
            scripthashes.push(reversedHash);
            scripthash2addr[reversedHash] = addr;
        }

        let results = [];

        if (disableBatching) {
            // ElectrumPersonalServer doesnt support `blockchain.scripthash.listunspent`
            // electrs OTOH supports it, but we dont know it we are currently connected to it or to EPS
            // so it is pretty safe to do nothing, as caller can derive UTXO from stored transactions
        } else {
            results = await g.state?.client.blockchainScripthash_listunspentBatch(scripthashes);
        }

        for (const utxos of results) {
            ret[scripthash2addr[utxos.param]] = utxos.result;
            for (const utxo of ret[scripthash2addr[utxos.param]]) {
                utxo.address = scripthash2addr[utxos.param];
                utxo.txId = utxo.tx_hash;
                utxo.vout = utxo.tx_pos;
                delete utxo.tx_pos;
                delete utxo.tx_hash;
            }
        }
    }

    return ret;
};

const calculateBlockTime = function (height) {
    if (latestBlockheight) {
        return Math.floor(latestBlockheightTimestamp + (height - latestBlockheight) * 9.93 * 60);
    }

    const baseTs = 1627344672; // sec
    const baseHeight = 4085;
    return Math.floor(baseTs + (height - baseHeight) * 9.93 * 60);
};

const estimateCurrentBlockheight = function () {
    if (latestBlockheight) {
        return latestBlockheight;
        /*const timeDiff = Math.floor(+new Date() / 1000) - latestBlockheightTimestamp;
        const extraBlocks = Math.floor(timeDiff / (9.93 * 60));
        return latestBlockheight + extraBlocks;*/
    }

    const baseTs = 1627344672264; // uS
    const baseHeight = 4085;
    return Math.floor(baseHeight + (+new Date() - baseTs) / 1000 / 60 / 9.93);
};

const getTransactionsByAddress = async function (address) {
    if (!g.state?.client) throw '';
    const script = bitcoin.address.toOutputScript(address);
    const hash = bitcoin.crypto.sha256(script);
    const reversedHash = Buffer.from(reverse(hash));
    const history = await g.state?.client.blockchainScripthash_getHistory(reversedHash.toString('hex'));
    for (const h of history || []) {
        if (h.tx_hash) txhashHeightCache[h.tx_hash] = h.height; // cache tx height
    }

    return history;
};

const getBalanceByAddress = async function (address) {
    if (!g.state?.client) throw '';
    const script = bitcoin.address.toOutputScript(address);
    const hash = bitcoin.crypto.sha256(script);
    const reversedHash = Buffer.from(reverse(hash));
    const balance = await g.state?.client.blockchainScripthash_getBalance(reversedHash.toString('hex'));
    balance.addr = address;
    return balance;
};

const broadcastV2 = async function (hex) {
    if (!g.state?.client) throw '';
    return g.state?.client.sendTransaction(hex);
};

const splitIntoChunks = function (arr, chunkSize) {
    const groups = [];
    let i;
    for (i = 0; i < arr.length; i += chunkSize) {
        groups.push(arr.slice(i, i + chunkSize));
    }
    return groups;
};

function txhexToElectrumTransaction(txhex) {
    const tx = bitcoin.Transaction.fromHex(txhex);

    const ret = {
        txid: tx.getId(),
        hash: tx.getId(),
        version: tx.version,
        size: Math.ceil(txhex.length / 2),
        vsize: tx.virtualSize(),
        weight: tx.weight(),
        locktime: tx.locktime,
        vin: [],
        vout: [],
        hex: txhex,
        blockhash: '',
        confirmations: 0,
        time: 0,
        blocktime: 0,
    };

    if (txhashHeightCache[ret.txid]) {
        // got blockheight where this tx was confirmed
        ret.confirmations = estimateCurrentBlockheight() - txhashHeightCache[ret.txid];
        if (ret.confirmations < 0) {
            // ugly fix for when estimator lags behind
            ret.confirmations = 1;
        }
        ret.time = calculateBlockTime(txhashHeightCache[ret.txid]);
        ret.blocktime = calculateBlockTime(txhashHeightCache[ret.txid]);
    }

    for (const inn of tx.ins) {
        const txinwitness = [];
        if (inn.witness[0]) txinwitness.push(inn.witness[0].toString('hex'));
        if (inn.witness[1]) txinwitness.push(inn.witness[1].toString('hex'));

        ret.vin.push({
            txid: reverse(inn.hash).toString('hex'),
            vout: inn.index,
            scriptSig: { hex: inn.script.toString('hex'), asm: '' },
            txinwitness,
            sequence: inn.sequence,
        });
    }

    let n = 0;
    for (const out of tx.outs) {
        const value = new BigNumber(out.value).dividedBy(1000000).toNumber();
        let address = false;
        let type = false;

        if (SegwitBech32Wallet.scriptPubKeyToAddress(out.script.toString('hex'))) {
            address = SegwitBech32Wallet.scriptPubKeyToAddress(out.script.toString('hex'));
            type = 'witness_v0_keyhash';
        } else if (SegwitP2SHWallet.scriptPubKeyToAddress(out.script.toString('hex'))) {
            address = SegwitP2SHWallet.scriptPubKeyToAddress(out.script.toString('hex'));
            type = '???'; // TODO
        } else if (LegacyWallet.scriptPubKeyToAddress(out.script.toString('hex'))) {
            address = LegacyWallet.scriptPubKeyToAddress(out.script.toString('hex'));
            type = '???'; // TODO
        }

        ret.vout.push({
            value,
            n,
            scriptPubKey: {
                asm: '',
                hex: out.script.toString('hex'),
                reqSigs: 1, // todo
                type,
                addresses: [address],
            },
        });
        n++;
    }
    return ret;
}

export {
    multiGetHistoryByAddress,
    multiGetTransactionByTxid,
    multiGetBalanceByAddress,
    multiGetUtxoByAddress,
    getTransactionsByAddress,
    getBalanceByAddress,
    broadcastV2,
    calculateBlockTime,
    estimateCurrentBlockheight,
}

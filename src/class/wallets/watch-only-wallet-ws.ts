import {WatchOnlyWallet} from "~src/class";
import {BlueElectrumClient, PlainTransaction} from "@nimiq/electrum-client";

export class WatchOnlyWalletWS extends WatchOnlyWallet {
    private callbacks: Map<string, Function>;
    private debounce: { transactions: number, balance: number };
    constructor() {
        super();
        this.callbacks = new Map();
        this.debounce = {
            transactions: 0,
            balance: 0,
        };
    }

    prepareForSerialization() {
        delete this.callbacks;
        delete this.debounce;
        super.prepareForSerialization();
    }

    executeCallBacks () {
        this.callbacks.forEach(cb => cb(this));
    }

    registerCallBack (id: string, cb: Function) {
        this.callbacks.set(id, cb);
    }

    addTransactionListener(client: BlueElectrumClient) {
        client?.addTransactionListener(this.handleTransactions.bind(this), [this.getAddress()]);
    }

    handleTransactions(tx?: PlainTransaction) {
        //this.fetchTransactions();
        this.fetchBalance();
    }

    async fetchTransactions() {
        if (+Date.now - this.debounce.transactions < 10) return;
        this.debounce.transactions = +Date.now();
        await super.fetchTransactions();
        this.executeCallBacks();
    }

    async fetchBalance() {
        if (+Date.now() - this.debounce.balance < 10) return;
        this.debounce.balance = +Date.now();
        await super.fetchBalance();
        this.executeCallBacks();
    }
}

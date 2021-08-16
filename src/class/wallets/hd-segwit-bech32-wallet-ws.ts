import {HDSegwitBech32Wallet} from "~src/class";
import {BlueElectrumClient} from "@nimiq/electrum-client";

export class HDSegwitBech32WalletWS extends HDSegwitBech32Wallet {
    private listenerId: number;
    private walletChangedListeners: Map<number, Function>;
    private callbacks: Map<string | number, Function>;
    private debounce: { transactions: number, balance: number, utxo: number };
    private fetchTimeout: any;
    private listeningTo: Set<string>;
    private transactionListenerIds: Set<any>;
    constructor() {
        super();
        this.listenerId = 0;
        this.walletChangedListeners = new Map();
        this.callbacks = new Map();
        this.debounce = {
            transactions: 0,
            balance: 0,
            utxo: 0,
        }
        this.fetchTimeout = 0;
        this.listeningTo = new Set();
        this.transactionListenerIds = new Set();
    }

    prepareForSerialization() {
        delete this.listenerId;
        delete this.walletChangedListeners;
        delete this.debounce;
        delete this.listeningTo;
        delete this.transactionListenerIds;
        super.prepareForSerialization();
    }

    addTransactionListener(client?: BlueElectrumClient) {
        // @ts-ignore
        if (!this.external_addresses_cache) return;
        const allAddresses = [
            // @ts-ignore
            ...Object.values(this.external_addresses_cache),
            // @ts-ignore
            ...Object.values(this.internal_addresses_cache),
        ];
        // @ts-ignore
        const notListening = [...allAddresses].filter(address => !this.listeningTo.has(address));
        // @ts-ignore
        const id = client?.addTransactionListener(this.handleTransactions.bind(this), notListening); // todo AAAH
        this.transactionListenerIds.add(id);
        // @ts-ignore
        notListening?.forEach(address => this.listeningTo.add(address));
    }

    removeTransactionListener(client?: BlueElectrumClient) {
        this.transactionListenerIds.forEach(id => client?.removeListener(id));
    }

    async handleTransactions(tx?: any) {
        clearTimeout(this.fetchTimeout);
        this.fetchTimeout = setTimeout(async () => {
            await this.fetchTransactions(true);
            await this.fetchBalance(true);
            await this.fetchUtxo(true);
            // @ts-ignore
            if (this.fetchPendingTransactions) {
                // @ts-ignore
                await this.fetchPendingTransactions();
            }
            //this.addTransactionListener();
            if (tx === 'false') return;
            this.notifyWalletChanged();
        }, 10000); // todo arbitrary time limit for queue break. this should be improved upon at some point
    }

    async fetchTransactions(UI=false) {
        if (!UI && +Date.now - this.debounce.transactions < 100) return;
        this.debounce.transactions = +Date.now();
        await super.fetchTransactions();
        //this.executeCallBacks();
    }

    async fetchBalance(UI=false) {
        if (!UI && +Date.now() - this.debounce.balance < 100) return;
        this.debounce.balance = +Date.now();
        await super.fetchBalance();
        //this.executeCallBacks();
    }

    async fetchUtxo(UI=false) {
        if (!UI && +Date.now() - this.debounce.utxo < 100) return;
        this.debounce.utxo = +Date.now();
        await super.fetchUtxo();
        //this.executeCallBacks();
    }

    addWalletChangedListener(listener: Function): number {
        const listenerId = this.listenerId++;
        this.walletChangedListeners.set(listenerId, listener);
        return listenerId;
    }

    notifyWalletChanged() {
        for (const listener of this.walletChangedListeners.values()) {
            listener(this);
        }
    }

    public removeListener(handle: number): void {
        this.walletChangedListeners.delete(handle);
    }
}

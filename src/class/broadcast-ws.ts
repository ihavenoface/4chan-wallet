import {BroadcastChannel, createLeaderElection} from 'broadcast-channel';
import {BlueElectrumClient, GenesisConfig, PlainBlockHeader} from "@nimiq/electrum-client";
import {HDSegwitBech32WalletWS, HDSegwitBech32Wallet, WatchOnlyWalletWS, WatchOnlyWallet} from "~src/class";
import {LeaderElector} from "broadcast-channel/types/leader-election";

declare type Message = {
    type: string;
    data: any;
};

export class State {
    public channel: BroadcastChannel; // fixme this should be private
    public elector: LeaderElector;
    private client: BlueElectrumClient | undefined;
    public head: PlainBlockHeader;
    public consensusState: string;
    private wallet: HDSegwitBech32Wallet;
    private walletWS: HDSegwitBech32WalletWS;
    private walletListenerId: number;
    public watchOnlyWallets: Map<string, WatchOnlyWallet>;
    private watchOnlyWalletsWS: Map<string, WatchOnlyWalletWS>;
    private listenerId: number;
    private stateChangedListeners: Map<number, Function>;
    private tabIsVisible: boolean;
    private transformInfoSection: object;
    private walletHistory: Map<number, WatchOnlyWalletWS>;
    constructor() {
        this.wallet = new HDSegwitBech32Wallet();
        this.walletWS = new HDSegwitBech32WalletWS();
        this.walletListenerId = 0;
        this.watchOnlyWallets = new Map();
        this.watchOnlyWalletsWS = new Map();
        this.listenerId = 0;
        this.stateChangedListeners = new Map();
        this.channel = new BroadcastChannel('supersecrittobechangedlater');
        this.channel.addEventListener('message', this.handleMessage);
        this.elector = createLeaderElection(this.channel);
        this.elector.awaitLeadership().then(this.handleLeadership);
        this.head = {
            blockHash: '',
            blockHeight: 0,
            timestamp: 0,
            bits: 0,
            nonce: 0,
            version: 0,
            weight: 0,
            prevHash: null,
            merkleRoot: null,
        };
        this.consensusState = 'not connected';
        this.tabIsVisible = !document.hidden;
        this.transformInfoSection = {};
        this.walletHistory = new Map();
        document.addEventListener('visibilitychange', () => {
            // todo: clean this up, move this to info section
            this.tabIsVisible = !document.hidden;
            if (this.tabIsVisible) {
                // @ts-ignore
                const position = this.transformInfoSection.position;
                // @ts-ignore
                const style = document.querySelector(this.transformInfoSection.selector)?.style;
                const str = `translate(${position?.x || 0}px, ${position?.y || 0}px)`;
                if (str === style?.transform) return;
                style.transform = str;
            }
        });
        if (this.hasWallet()) {
            this.fromJson(this.wallet);
            getOrGenerateSeed(this.wallet);
        }
    }

    async hasWallet() {
        // @ts-ignore
        return await GM_getValue('wallet', false);
    }

    async fromJson(hd: any) {
        // @ts-ignore
        await hd.fromJson(GM_getValue('wallet', "{}"), hd);
    }

    handleMessage = async (message: Message) => { // todo in general we should defer actions on inactive tabs, and update once we become active again
        const { type, data } = message;
        switch (type) {
            case 'move':
                if (this.transformInfoSection === data) return;
                this.transformInfoSection = data;
                if (this.tabIsVisible) {
                    // @ts-ignore
                    const position = this.transformInfoSection.position;
                    // @ts-ignore
                    const style = document.querySelector(this.transformInfoSection.selector)?.style;
                    const str = `translate(${position.x}px, ${position.y}px)`;
                    if (str === style.transform) return;
                    style.transform = str;
                }
                break;
            case 'wallet':
                this.handleWalletChanged(data);
                break;
            case 'watch-only-wallet':
                const wallet = new WatchOnlyWallet();
                wallet.fromObject(data, wallet);
                this.watchOnlyWallets.set(data.secret, wallet);
                this.notifyStateChanged();
                break;
            case 'consensus':
                this.handleConsensusChanged(data);
                // then again, probably shouldn't be handled here. pass that down and update elsewhere
                break;
            case 'head':
                this.handleHeadChanged(data);
                break;
            case 'state':
                // do something here?
                break;
        }
        if (!this.elector.isLeader) return;
        switch (type) {
            case 'get':
                switch (data) {
                    case 'is_there_a_leader':
                        this.channel.postMessage({
                            type: 'there_is_a_leader',
                            data: true,
                        })
                        break;
                    case 'wallet':
                        this.channel.postMessage({
                            type: 'wallet',
                            data: this.wallet,
                        });
                        break;
                    case 'head':
                        this.channel.postMessage({
                           type: 'head',
                           data: this.head,
                        });
                        break;
                    case 'consensus':
                        this.channel.postMessage({
                           type: 'consensus',
                           data: this.consensusState,
                        });
                        break;
                    case 'transform_info_section':
                        this.channel.postMessage({
                            type: 'move',
                            data: this.transformInfoSection,
                        });
                        break;
                }
                break;
            case 'get_multi':
                // todo do not split this
                data.forEach((data: Message) => this.handleMessage({type: 'get', data}));
                break;
            case 'broadcast_tx':
                this.handleWalletChanged(data.wallet);
                this.walletWS.fromObject(data.wallet, this.walletWS);
                await this.walletWS.broadcastTx(data.tx);
                this.walletWS.addTransactionListener(this.client);
                break;
            case 'subscribe_address':
                // always pass in array
                data.forEach(this.handleSubRequested);
                break;
        }
    }

    handleSubRequested = async (data: string) => {
        if (this.watchOnlyWalletsWS.has(data)) {
            this.handleWatchOnlyWalletUpdated(this.watchOnlyWalletsWS.get(data));
            return;
        }
        const wallet = new WatchOnlyWalletWS();
        wallet.setSecret(data);
        this.watchOnlyWalletsWS.set(data, wallet);
        wallet.registerCallBack(data, this.handleWatchOnlyWalletUpdated); // todo update this
        // @ts-ignore
        wallet.addTransactionListener(this.client);
        wallet.fetchBalance();
    }

    handleLeadership = async () => {
        this.walletWS.addWalletChangedListener(this.handleWalletUpdated);
        // @ts-ignore
        this.alt = new BroadcastChannel('supersecrittobechangedlater');
        // @ts-ignore
        this.alt.addEventListener('message', this.handleMessage);
        this.fromJson(this.walletWS);
        getOrGenerateSeed(this.walletWS);
        try {
            GenesisConfig.main();
        } catch (e) {}
        this.client = new BlueElectrumClient();
        this.walletWS.addTransactionListener(this.client);
        this.client.addConsensusChangedListener((consensusState) => {
            this.channel.postMessage({
                type: 'consensus',
                data: consensusState,
            });
        });
        this.client.addHeadChangedListener((block) => {
            this.channel.postMessage({
                type: 'head',
                data: block,
            });
        });
        // todo check if we need this
        await this.client.waitForConsensusEstablished();
        //this.notifyStateChanged();
        this.walletWS.handleTransactions();
        this.watchOnlyWalletsWS.forEach(wallet => wallet.handleTransactions());
    }

    isThereALeaderActive = async () => {
        return new Promise<void>(resolve => {
            if (this.elector.isLeader) {
                resolve();
                return;
            }
            const channel = new BroadcastChannel('supersecrittobechangedlater');
            channel.addEventListener('message', message => {
                if (message.type === 'there_is_a_leader' && message.data === true) {
                    channel.close();
                    clearInterval(to);
                    resolve();
                }
            });
            const to = setInterval(() => {
                channel.postMessage({
                    type: 'get',
                    data: 'is_there_a_leader',
                });
            }, 10);
        });
    }

    handleWalletUpdated = (old: HDSegwitBech32WalletWS) => {
        const wallet = new HDSegwitBech32WalletWS();
        wallet.fromObject(old, wallet);
        wallet.prepareForSerialization();
        saveWallet(wallet);
        this.channel.postMessage({
            type: 'wallet',
            data: wallet,
        });
    }

    handleWatchOnlyWalletUpdated = async (old: WatchOnlyWalletWS | undefined) => {
        const wallet = new WatchOnlyWalletWS();
        wallet.fromObject(old, wallet);
        wallet.prepareForSerialization();
        // @ts-ignore
        let cache = await GM_getValue('watch-only-wallets', {});
        if (Object.keys(cache).length > 10000)
            cache = {};
        cache[wallet.getSecret()] = wallet;
        // @ts-ignore
        GM_setValue('watch-only-wallets', cache);
        this.channel.postMessage({
           type: 'watch-only-wallet', // todo merge this with 'wallet'
           data: wallet,
        });
    }

    handleConsensusChanged = (data: string) => {
        if (this.consensusState === data) return;
        this.consensusState = data;
        this.notifyStateChanged();
    }

    handleHeadChanged = (data: PlainBlockHeader) => {
        if (this.head === data) return;
        this.head = data;
        this.notifyStateChanged();
    }

    handleWalletChanged = (data: any) => {
        const wallet = new HDSegwitBech32Wallet();
        wallet.fromObject(data, wallet);
        wallet.prepareForSerialization();
        this.wallet.fromObject(wallet, this.wallet);
        this.notifyStateChanged();
    }

    addStateChangedListener(listener: Function): number {
        const listenerId = this.listenerId++;
        this.stateChangedListeners.set(listenerId, listener);
        return listenerId;
    }

    notifyStateChanged() {
        for (const listener of this.stateChangedListeners.values()) {
            listener(this);
        }
    }

    public removeListener(handle: number): void {
        this.stateChangedListeners.delete(handle);
    }

    attemptToBootstrapFromPeer() {
        const reqInterval = setInterval(() => {
            // todo connection is never guaranteed. in case of a network failure, this poll creates unneeded overhead
            if (!this.elector.isLeader && (!this.head.blockHeight || this.consensusState === 'not connected')) {
                this.channel.postMessage({type: 'get', data: 'state'});
            } else {
                clearInterval(reqInterval);
            }
        }, 100)
    }
}

const getOrGenerateSeed = async (hd: any) => {
    // @ts-ignore
    let secret = await GM_getValue('secret', '');
    const cached = hd.getSecret();
    if (cached && secret && (cached === secret)) return;
    if (secret !== undefined && secret !== null && (secret.split(' ').length === 12 || secret.split(' ').length === 24)) {
        hd.setSecret(secret);
        if (hd.validateMnemonic()) {
            if (!cached) {
                // @ts-ignore
                GM_setValue('secret', secret);
            }
            return;
        }
    }
    await hd.generate();
    if (hd.validateMnemonic()) {
        // @ts-ignore
        GM_setValue('secret', hd.getSecret());
    }
}

const saveWallet = (wallet: HDSegwitBech32WalletWS) => {
    //wallet.prepareForSerialization();
    // @ts-ignore
    GM_setValue('wallet', JSON.stringify(wallet));
}

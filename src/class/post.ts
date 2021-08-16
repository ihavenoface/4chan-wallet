import {ConsensusState, PlainTransaction} from "@nimiq/electrum-client";
import BigNumber from "bignumber.js";
import g from "~src/store/env";
import {BroadcastChannel} from "broadcast-channel";
const bitcoin = require('bitcoinjs-lib');

export class Post {
    public node: Element;
    public targetNode: Element | undefined | null;
    public address: string | false;
    public transactions: Map<string, PlainTransaction>;
    public wallet: any;
    private txQueue: BigNumber;
    public trip: string | false;
    public uidContainer: any;
    public uid: string | false;
    public postId: string;
    public postIdNumber: number;
    private walletNode: Element;
    public leader: Post | false;
    public siblings: Map<string, Post>;
    private pollId: any;
    // first selector for 4chan x, second for native
    private static fileSelector: string = '.fileText-original a[title], .fileText a[title]';
    private static wrapperClassName: string = 'wallet';
    public static allowedQuickSend: Map<number, string> = new Map([[10, "ten"], [50, "fifty"], [100, "hundred"], [500, "fivehundred"], [1000, "thousand"]]);
    constructor(node: Element) {
        this.node = node;
        this.address = Post.getAddress(this.node);
        this.transactions = new Map();
        this.txQueue = new BigNumber(0);
        this.walletNode = document.createElement('div');
        this.postId = Post.getPostId(this.node);
        this.postIdNumber = Post.getPostIdNumber(this.node);
        this.uid = false;
        this.trip = Post.getPostTrip(this.node as HTMLElement) || false;
        this.uidContainer = this.getUidContainer();
        this.leader = false;
        this.siblings = new Map();
        //this.wallet = new WatchOnlyWallet();
        this.pollId = 0;
        if (this.uidContainer && this.uidContainer.textContent.length) {
            this.uid = this.uidContainer.textContent;
        }
        // @ts-ignore
        g.state?.addStateChangedListener((state) => { // todo move this out of init and wait for state to be established
            // todo possibly lift this to thread
            const wallet = state.watchOnlyWallets.get(this.address);
            if (wallet) {
                this.wallet = wallet;
                this.insertHtml();
                this.siblings.forEach(p => p.insertHtml());
            }
        });
    }

    static decrypt(encryptedString: string) {
        try {
            return `pn1${encryptedString.split('').reverse().join('')}`;
        } catch (_) {
            return false;
        }
    }

    getWalletNode() {
        return this.walletNode;
    }

    public static getAddress(node: Element): string | false { // get the pub key
        const query = node.querySelector<HTMLElement>(Post.fileSelector);
        if (!query) {
            return false;
        }
        let { title } = query;
        if (!title) {
            return false;
        }
        [title] = title.split('.');
        if (title.length > 150) {
            console.log(`Title length of ${title} too long. Skipping.`)
            return false;
        }
        title = title.replace(/-/g, '/');
        const address = Post.decrypt(title);
        try {
            bitcoin.address.toOutputScript(address);
            return address;
        } catch (e) {
            return false;
        }
    }

    getUidContainer(node=this.node) {
        return node.querySelector('.desktop .hand');
    }

    getTxQueue() {
        return this.txQueue;
    }

    updateTxQueue(amount: BigNumber, reset?: boolean) {
        if (amount.plus(this.txQueue).lte(0)) reset = true;
        if (reset) return this.txQueue = new BigNumber(0);
        this.txQueue = this.txQueue.plus(amount);
    }

    setAddress(node=this.node) {
        this.address = Post.getAddress(node);
    }

    maybeAddSibling(node: Element): Post | false {
        if (!(this.uid || this.trip)) return false;
        const post = new Post(node);
        if (post.siblings.has(Post.getPostId(node))) return false;
        if (post.postId !== this.postId && ((post.uid == this.uid) || post.trip == this.trip)) {
            post.setAddress();
            post.leader = this;
            this.siblings.set(post.postId, post);
            return post;
        }
        return false;
    }

    insertHtml() {
        const postMessage = this.node.querySelector('.postMessage');
        if (!postMessage?.parentNode) {
            return;
        }
        const { parentNode } = postMessage;
        const wrapper = this.renderHtml();
        this.walletNode = wrapper;
        if (this.targetNode) {
            const dupes = parentNode.querySelectorAll(`#${this.postId} .post > .${Post.wrapperClassName}`);
            if (dupes[1]) {
                dupes.forEach((dupe, num) => { // cant use shift here
                    if (!num) return;
                    parentNode.removeChild(dupe);
                });
                this.targetNode = dupes[0];
            }
            if (this.targetNode.innerHTML !== wrapper.innerHTML) {
                this.targetNode.innerHTML = wrapper.innerHTML;
            }
            return;
        }
        if (postMessage.nextSibling) {
            parentNode.insertBefore(wrapper, postMessage.nextSibling);
        } else {
            parentNode.appendChild(wrapper);
        }
        this.targetNode = this.node.querySelector(`#${this.postId} .post > .${Post.wrapperClassName}`);
    }


    renderHtml() {
        // @ts-ignore
        const ce = g.state?.consensusState === ConsensusState.ESTABLISHED;
        // @ts-ignore
        const refreshIcon = g.fourchanX ? `<span class="fa fa-refresh fa-spin" title=${g.state?.consensusState} />` : '...';
        // @ts-ignore
        const ttr = (this.wallet || this.leader?.wallet)?.timeToRefreshBalance() || true;
        // this is still flat, but w/e. might get extended later on
        // @ts-ignore
        let balance = new BigNumber((this.wallet || this.leader?.wallet)?.getBalance() || 0);
        // @ts-ignore
        let unconfirmedBalance = new BigNumber((this.wallet || this.leader?.wallet)?.getUnconfirmedBalance() || 0);
        let totalBalance = new BigNumber(0);
        totalBalance = totalBalance.plus(balance).plus(unconfirmedBalance);
        if (totalBalance.lt(0)) {
            totalBalance = new BigNumber(0);
        }
        // @ts-ignore
        const balanceFormatted = !ttr || ce ? new Intl.NumberFormat().format(balance.dividedBy(1000000).toNumber()) : refreshIcon;
        const unconfirmedBalanceFormatted = !ttr || ce ? new Intl.NumberFormat().format(unconfirmedBalance.dividedBy(1000000).toNumber()) : refreshIcon;
        const totalBalanceFormatted = !ttr || ce ? new Intl.NumberFormat().format(totalBalance.dividedBy(1000000).toNumber()) : refreshIcon;
        // @ts-ignore
        const { postIdNumber } = (this.leader || this);
        const toSend = this.txQueue.gt(new BigNumber(0)) ? `<a class="wallet clear-to-send" href="javascript:;">Clear</a>: ${new Intl.NumberFormat().format(this.txQueue.toNumber())}` : '';
        let allowedQuickSendNodes = "";
        Post.allowedQuickSend.forEach((k, v) => {
            const num = new BigNumber(v);
            allowedQuickSendNodes += `<a 
               class="wallet ${k}"
               data-amount="${v}"
               title="Shift + Click: ${new Intl.NumberFormat().format(num.multipliedBy(10).toNumber())}
Ctrl + Click: ${new Intl.NumberFormat().format(num.negated().toNumber())}
Ctrl + Shift + Click: ${new Intl.NumberFormat().format(num.negated().multipliedBy(10).toNumber())}" 
               href="javascript:;">
                    ${new Intl.NumberFormat().format(num.toNumber())}
               </a>
               `.trim();
        });
        const wrapper = document.createElement('blockquote');
        wrapper.className = Post.wrapperClassName;
        wrapper.dataset.postid = postIdNumber.toString();
        wrapper.innerHTML = `
            <div class="balance">Available: ${balanceFormatted}, Pending: ${unconfirmedBalanceFormatted}, Total: ${totalBalanceFormatted}</div>
            <div><span class="wallet send-quick-options" data-postid="${postIdNumber}">Send: ${allowedQuickSendNodes.trim()}</span><span data-postid="${postIdNumber}">${toSend}</span></div>
        `.trim();
        return wrapper;
    }

    public static getPostId(node: Element) {
        return node?.id;
    }

    public static getPostIdNumber(node: Element): number {
        const postId = Post.getPostId(node);
        return Number(postId.slice(2));
    }

    public static getPostTrip(node: HTMLElement) {
        return node?.querySelector('.postertrip')?.textContent;
    }

    public static getUid(node: Element) {
        return node?.querySelector('.desktop .hand')?.textContent;
    }

    public static isNodeAPost(node: HTMLElement): boolean {
        return !!node?.parentElement?.classList.contains('thread')
            && node.nodeName === 'DIV'
            && node.classList.contains('postContainer')
            && !!Post.getAddress(node);
    }

    public static hasNodeAUid(node: HTMLElement): boolean {
        return !!Post.getUid(node);
    }

    public static hasNodeATrip(node: HTMLElement): boolean {
        return !!Post.getPostTrip(node);
    }
}

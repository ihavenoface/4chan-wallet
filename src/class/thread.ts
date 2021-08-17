import {Post} from "~src/class/post";
import {BroadcastChannel} from 'broadcast-channel';
import g from "~src/store/env";
import BigNumber from "bignumber.js";

declare type Elements = NodeListOf<ChildNode> | HTMLElement[];

export default class Thread {
    private node: HTMLElement;
    private untouchedNodesByUid: Map<string, Set<HTMLElement>>;
    private readonly posts: Map<number, Post>;
    private postSiblingPairs: Map<Post, any>;
    private uids: Map<any, any>;
    private trips: Map<any, any>;
    constructor(node: HTMLDivElement) {
        this.node = node;
        this.posts = new Map();
        this.uids = new Map();
        this.trips = new Map();
        this.untouchedNodesByUid = new Map(); // deprecated / unused at the moment
        this.postSiblingPairs = new Map();
        this.node.addEventListener('click', this.handleThreadClicked);
        // todo listen to state change or handle that in ops and pass it down
        // @ts-ignore
        g.state?.addStateChangedListener((state) => {
            state.watchOnlyWallets
        });
    }
/*
    handleStateChanged = (state: any) => {
        const wallets = state.watchOnlyWallets;
    }
*/
    collectInFlight = () => {
        // todo: lift this up
        const inFlight = [...this.posts.values()].filter(post => post.getTxQueue().gt(new BigNumber(0)));
        let collectiveOut = new BigNumber(0);
        inFlight.forEach((post) => {
            collectiveOut = collectiveOut.plus(post.getTxQueue());
        });
        return collectiveOut;
    }

    handleThreadClicked = (e: any) => {
        if (!e.target.classList.contains("wallet")) return;
        // @ts-ignore
        if (g.infoSection?.activeView !== "default") return;
        const postIdNumber = Number(e.target.parentNode.dataset.postid);
        const post = this.posts.get(postIdNumber);
        if (!post) return;
        e.preventDefault();
        if (e.target.classList.contains('clear-to-send')) {
            post.updateTxQueue(new BigNumber(0), true);
            post.siblings.forEach(post => post.updateTxQueue(new BigNumber(0), true));
            post.insertHtml();
            post.siblings.forEach(p => p.insertHtml());
            // @ts-ignore
            g.infoSection?.update();
            return;
        }
        const san = post.getWalletNode().querySelector(`.send-quick-options .${[...e.target.classList].join('.')}`);
        if (!san) return;
        // @ts-ignore
        g.infoSection?.update();
        // @ts-ignore
        let toUpdate = new BigNumber(Number(san.dataset.amount));
        if (e.ctrlKey) {
            toUpdate = toUpdate.negated();
        }
        if (e.shiftKey) {
            toUpdate = toUpdate.multipliedBy(10);
        }
        // @ts-ignore
        if (this.collectInFlight().plus(toUpdate).plus(100).multipliedBy(1000000).gte(new BigNumber(g.state?.wallet.getBalance()))) return; // fixme fee is a bit dumb here
        post.updateTxQueue(toUpdate);
        post.siblings.forEach(post => post.updateTxQueue(toUpdate)); // todo, this is bad practice. it should be assigned to sibling
        post.insertHtml();
        post.siblings.forEach(p => p.insertHtml());
        // @ts-ignore
        g.infoSection?.update();
    }


    setPostNode(node: HTMLElement, posts = this.posts) {
        const post = new Post(node);
        posts.set(post.postIdNumber, post);
    }

    setPostNodes (nodes: HTMLElement[], posts = this.posts) {
        nodes.forEach(node => this.setPostNode(node, posts));
    }

    getAdjacentPostsOfNode(node: HTMLElement): any {
        const postIdNumber = Post.getPostIdNumber(node);
        const uid = Post.getUid(node);
        const trip = Post.getPostTrip(node);
        if (!postIdNumber || !(uid || trip)) return {};
        const postsOfSameUidOrTrip = [...this.posts.values()].filter(p => { return (uid === p.uid) || trip === p.trip});
        const prevPost = postsOfSameUidOrTrip.reverse().find(p => p.postIdNumber < postIdNumber);
        const nextPost = postsOfSameUidOrTrip.find(p => p.postIdNumber > postIdNumber);
        return {prevPost, nextPost};
    }

    findAndAddToBoundingPost (nodes: Elements = this.node.childNodes): void {
        [].slice.call(nodes).forEach(node => {
            if (Post.isNodeAPost(node)) return;
            if (!Post.getPostIdNumber(node)) return;
            const {prevPost, nextPost} = this.getAdjacentPostsOfNode(node);
            (prevPost || nextPost)?.maybeAddSibling(node);
        });
    }

    async processNodes (nodes: Elements = this.node.childNodes)  {
        this.setPostNodes(this.getPostNodes(nodes));
        this.findAndAddToBoundingPost(this.getUidNodes(nodes));
        this.findAndAddToBoundingPost(this.getTripNodes(nodes));
        this.posts.forEach(post => {
           post.insertHtml();
           post.siblings.forEach(post => post.insertHtml());
        });
        // @ts-ignore
        await g.state.isThereALeaderActive(); // still probably not ideal, as the leader can drop at any moment
        // we should also refill once a leader dies and a new one becomes active
        this.updateListeners();
    }

    updateListeners () {
        const channel = new BroadcastChannel("supersecrittobechangedlater");
        channel.postMessage({
            type: 'subscribe_address',
            data: [...new Set([...this.posts.values()].map(p => p.address))],
        });
        channel.close();
    }

    getPostNodes (nodes: Elements = this.node.childNodes): HTMLElement[] {
        return [].slice.call(nodes).filter(Post.isNodeAPost);
    }

    getUidNodes (nodes: Elements = this.node.childNodes): HTMLElement[] {
        return [].slice.call(nodes).filter(Post.hasNodeAUid);
    }

    getTripNodes (nodes: Elements = this.node.childNodes): HTMLElement[] {
        return [].slice.call(nodes).filter(Post.hasNodeATrip);
    }

    // getClonedNodes()

    getPosts () {
        return this.posts;
    }
}

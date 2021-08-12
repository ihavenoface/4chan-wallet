// @ts-nocheck
import posts from "~src/store/posts";
import BigNumber from "bignumber.js";
import g from "~src/store/env";
import createPsbtTransaction from "~src/helpers/createPsbtTransaction";
import {ConsensusState} from "@nimiq/electrum-client";
import {BroadcastChannel} from 'broadcast-channel';

export class InfoSection {
    public parentNode: Element;
    private node: Element | undefined | null;
    private clickListener: number;
    public activeView: string = 'default';
    constructor(parentNode: Element) {
        this.parentNode = parentNode;
        this.clickListener = 0;
        this.moreInfo = false;
        // @ts-ignore
        g.state?.addStateChangedListener(this.update.bind(this));
    }

    getNode() {
        return this.node;
    }

    handleClick(e: any) {
        this.handleSendClicked(e);
        this.handleHandClicked(e);
        this.handleCreateClicked(e);
        this.handleClearAllClicked(e);
        this.handleClearSingleClicked(e);
        this.handleMoreInfoClicked(e);
    }

    async handleSendClicked(e: any) {
        if (!e.target.classList.contains('send-transaction')) return;
        if (this.activeView !== 'pending') return;
        if (!g.pendingTransaction) return;
        const channel = new BroadcastChannel('supersecrittobechangedlater');
        g.state.wallet.prepareForSerialization();
        channel.postMessage({
           type: 'broadcast_tx',
           data: {
               tx: g.pendingTransaction.tx.toHex(),
               wallet: g.state.wallet,
           },
        });
        channel.close();
        // @ts-ignore
        this.node?.querySelector('.clear-pending-transaction').click();
        [...posts.values()].filter(p => p.getTxQueue().gt(0))
            .map(post => {
                // @ts-ignore
                post.node.querySelector('.clear-to-send')?.click();
            });
        g.pendingTransaction = undefined;
        this.activeView = 'default';
        this.update();
    }

    handleCreateClicked(e: any) {
        if (!e.target?.classList.contains('create-transaction')) return;
        if (this.activeView !== 'default') return;
        this.activeView = 'pending';
        const targets = [...posts.values()].filter(p => p.getTxQueue().gt(0))
            .map(p => {return {address: p.address, value: p.getTxQueue().multipliedBy(1000000).toNumber()}});
        // @ts-ignore
        g.pendingTransaction = createPsbtTransaction(g.state.wallet, targets);
        // @ts-ignore
        g.pendingTransaction.then((tx) => this.handleTx.bind(this)(tx));
    }

    handleClearAllClicked(e: any) {
        if (!e.target?.classList.contains('clear-pending-transaction')) return;
        g.pendingTransaction = undefined;
        this.activeView = 'default';
        this.update();
    }

    handleClearSingleClicked(e: any) {
        if (!e.target?.classList.contains('clear-single-transaction')) return;
        if (this.activeView !== 'default') return;
        const [post] = [...posts.values()].filter(p => p.postId === e.target.dataset.postid);
        // @ts-ignore
        post.node.querySelector('.clear-to-send')?.click()
    }

    handleHandClicked(e: any) {
        if (!e.target?.classList.contains('hand')) return;
        let clicked: boolean = false;
        posts.forEach(post => {
            if (clicked) return;
            if (e.target.textContent !== post.uidContainer.textContent) return;
            post.uidContainer.click();
            clicked = true;
        });
    }

    handleMoreInfoClicked(e: any) {
        if (!e.target?.classList.contains('more-info')) return;
        this.moreInfo = !this.moreInfo;
        this.update();
    }

    handleTx(tx: any) {
        g.pendingTransaction = tx;
        this.update();
    }

    consensusStateBlob() {
        let color = 'grey';
        // @ts-ignore
        switch (g.state.consensusState) {
            case ConsensusState.CONNECTING:
                color = 'red';
                break;
            case ConsensusState.SYNCING:
                color = 'orange';
                break;
            case ConsensusState.ESTABLISHED:
                color = 'green';
                break;
        }
        return `
        <span 
        title="Websocket Connection: ${g.state.consensusState[0].toUpperCase() + g.state.consensusState.slice(1)}"
        style="
            cursor: default;
            height: 8px;
            width: 8px;
            background-color: ${color};
            border-radius: 50%;
            display: inline-block;
            position: absolute;
            right: 6px;
            top: 6px;
        "/>
        `
    }

    collectInFlight(fourchanX: boolean) {
        const inFlight = [...posts.values()].filter(post => post.getTxQueue().gt(new BigNumber(0)));
        if (!inFlight.length) return { html: '', collectiveOut: new BigNumber(0) };
        const hr = document.querySelector('hr');
        const hrStyleCollection = fourchanX && hr ? getComputedStyle(hr) : {
            borderTop: '1px solid #b7c5d9',
        };
        const hrStyle = `border-top: ${hrStyleCollection.borderTop}`;
        let html = '<br><table style="margin: 0 0 0 0; min-width: 100px; width: auto">New Transaction';
        let collectiveOut = new BigNumber(0);
        inFlight.forEach((post) => {
            const postOrUid = post.uid
                ? `<span class="posteruid">${post.uidContainer.cloneNode(true).outerHTML}</span>`
                : post.postId.replace(/_.*|pc/g, '');
            const txQueue = post.getTxQueue();
            collectiveOut = collectiveOut.plus(txQueue);
            html += `
            <tr>
              <td style="padding-right: 10px;">
                ${postOrUid}
              </td>
              <td>
                <span style="float: right;">
                  ${new Intl.NumberFormat().format(txQueue.toNumber())}
                </span>
              </td>
              <td style="padding-left: 5px;">
                <span> <a class="wallet clear-single-transaction" data-postId="${post.postId}" href="javascript:;">Clear</a></span>
              </td>
            </tr>
            `.trim();
        });
        if (this.activeView === 'pending') {
            // @ts-ignore
            const fee = new BigNumber(g.pendingTransaction.fee).dividedBy(1000000).toNumber();
            html += `
            <tr>
                <td style="padding-right: 10px;">
                  Fee:
                </td>
                <td style="float: right;">
                  ${new Intl.NumberFormat().format(fee)}
                </td>               
            </tr>
            `.trim();
        }
        html += `
            <tr>
              <td style="padding-right: 10px; ${hrStyle}">
                Total:
              </td>
              <td style="${hrStyle};">
                <span style="float: right;">
                  ${new Intl.NumberFormat().format(collectiveOut.toNumber())}
                </span>
              </td>
            </tr>
            </table>
            <div>
              <a class="wallet create-transaction" href="javascript:;">Create</a>
              ${this.activeView === 'pending' ? '<a class="wallet clear-pending-transaction" href="javascript:;">Clear</a>' : ''}
            </div>
        `.trim();
        return { html, collectiveOut };
    }

    insert(parent: any) {
        this.parentNode = parent;
        parent.appendChild(this.render(g.fourchanX));
        this.node = parent.querySelector('.wallet.info');
        this.node?.addEventListener('click', this.handleClick.bind(this));
    }

    update(state?: any) { // todo make this mandatory?
        if (!this.node) return;
        try {this.handleClearAllClicked()} catch (_) {}
        const { innerHTML } = this.render(g.fourchanX);
        if (this.node.innerHTML === innerHTML) return;
        this.node.innerHTML = innerHTML;
    }

    render(fourchanX: boolean) {
        // todo cache this output and backcheck if we are clicking on our own elements
        const container = document.createElement('div');
        container.classList.add('wallet');
        container.classList.add('info');
        container.classList.add('dialog');
        container.style.position = 'fixed';  // fixme: add this to STYLESHEETS config
        container.style.right = '20px';
        container.style.top = '30px';
        container.style.padding = '5px';
        if (!fourchanX) {
            const reply = document.querySelector('.reply:not(.yourPost)');
            const dialogStyleCollection = reply ? getComputedStyle(reply) : {
                backgroundColor: '#d6daf0',
                borderWidth: '1px',
                borderStyle: 'solid',
                borderColor: '#b7c5d9',
            }
            container.style.backgroundColor = dialogStyleCollection.backgroundColor;
            container.style.borderWidth = '1px';
            container.style.borderStyle = dialogStyleCollection.borderStyle
            container.style.borderColor = dialogStyleCollection.borderColor;
        }
        const seed = `<div><pre>${g.state.wallet?.getSecret()?.split(' ').map((s, i) => `${i+1}. ${s}\n`).join('')}</pre></div>`
        const { html, collectiveOut } = this.collectInFlight(fourchanX);
        const balance = new BigNumber(g.state.wallet.getBalance());
        let unconfirmed: string | number = g.state.wallet.getUnconfirmedBalance();
        unconfirmed = unconfirmed ? `<div>Unconfirmed:&nbsp;<span style="float:right;">${new Intl.NumberFormat().format(new BigNumber(unconfirmed).dividedBy(1000000).toNumber())}</span>` : '';
        const outputAmount = new BigNumber(collectiveOut).multipliedBy(1000000);
        let fees = new BigNumber(0);
        if (this.activeView === 'pending') {
            // @ts-ignore
            fees = new BigNumber(g.pendingTransaction.fee);
        }
        const full = new Intl.NumberFormat().format(new BigNumber(new BigNumber(balance).minus(outputAmount).minus(fees).dividedBy(1000000)).toNumber())
        const minus = collectiveOut.gt(0)
            ? `<div>
                 After Send:
                 <span style="float: right;" ${this.activeView === 'pending' ? '' : 'title="Before fees"'}>
                    ${this.activeView === 'pending' ? '&nbsp;' : '&nbsp;~ '}${full}
                 </span>
                 </div>`
            : '';
        container.innerHTML = `
            <div class="drag-handle" style="cursor: move;"><a href="javascript:;" class="wallet more-info" title="This will show your seed phrase">Wallet</a>${this.consensusStateBlob()}</div>
            ${this.moreInfo ? `<div>This is your seed phrase. You know the rest.<pre>${g.state.wallet?.getSecret()?.split(' ').map((s, i) => `${i+1}. ${s}\n`).join('') || ''}</pre></div>` : ''}
            ${g.state.head?.blockHeight ? `<div>Block:&nbsp;<span style="float: right;" title="${new Date(g.state.head?.timestamp * 1000).toLocaleString()}">${g.state.head?.blockHeight}</span></div>` : ''}
            <div>Balance:&nbsp;<span style="float: right;">${new Intl.NumberFormat().format(new BigNumber(g.state.wallet.getBalance()).dividedBy(1000000).toNumber())}</span></div>
            ${unconfirmed}
            ${minus}
            ${html}
            ${this.activeView === 'pending' ? '<div><a href="javascript:;" class="wallet send-transaction">Send</a></div>' : ''}
        `.trim();
        return container;
    }
}

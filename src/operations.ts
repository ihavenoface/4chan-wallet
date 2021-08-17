import {Operation, operation} from "userscripter/lib/operations";
import {BroadcastChannel} from 'broadcast-channel';
import {ALWAYS, DOMCONTENTLOADED} from "userscripter/lib/environment";
import {Post} from "~src/class/post";
import posts from "~src/store/posts";
import interact from "interactjs";
import {InfoSection} from "~src/class/infosection";
import g from "~src/store/env";
import {State} from "~src/class/broadcast-ws";
import Thread from "~src/class/thread";

let thread: Thread;
// @ts-ignore
g.state = new State();
// @ts-ignore
g.infoSection = new InfoSection(document.body, thread);

(async () => {
    // todo connection is never guaranteed. in case of a network failure, this poll creates unneeded overhead
    // todo additionally, on single tab setups we just spam ourselves constantly, which is kinda bad
    // @ts-ignore
    await g.state.isThereALeaderActive();
    const ch = new BroadcastChannel('supersecrittobechangedlater');
    ch.postMessage({type: 'get_multi', data: ['head', 'consensus', 'transform_info_section']});
    ch.close();
})()

function encryptAddress(address: string) {
    return address.split(/\w+1/)[1].split('').reverse().join('');
}

const updateNativeQuickReply = async (node: any=document.querySelector('#quickReply')) => {
    if (node?.id !== 'quickReply') return;
    const container = document.createElement('div');
    container.classList.add('wallet');
    container.classList.add('native');
    container.classList.add('nosupportnotice');
    container.style.width = 'min-content';
    // @ts-ignore
    const fileName = encryptAddress(await g.state.wallet.getAddressAsync()).replace(/\//g, '-');
    container.innerHTML = `
    <div class="blockme">4chan Wallet uses filenames to communicate your public keys to other 4chan Wallet users.</div>
    <div class="blockme">Automated replacements of filenames are not supported with the native extension at this time.</div>
    <div class="blockme"><a href="https://www.4chan-x.net/" target="_blank" class="quotelink">Install 4chan X</a> in case you would like to use this function right now.</div>
    <div class="blockme">Alternatively you may manually rename your file to the following (copy this in full):</div>
    <div style="clear: both"><textarea disabled>${fileName}</textarea></div>
    <div class="blockme"><b>This filename is dynamic, and will update each time you successfully receive any balance on any post / thread made by you.</b></div>
    <div class="blockme"><b>However, in case you do not receive any balance for a given thread, it will be re-used on the next post / thread.</b></div>
    <br class="blockme" />
    <div class="blockme">You may hide this message by adding the following filters to your adblocker:</div>
    <div class="blockme" style="clear: both"><textarea disabled>boards.4chan.org,boards.4channel.org##.nosupportnotice.native.wallet .blockme</textarea></div>
    `.trim();
    const el = node.querySelector('.wallet.native.nosupportnotice');
    if (el) {
        el.querySelector('textarea').textContent = fileName;
        return;
    }
    node.appendChild(container);
}

// @ts-ignore
g.state?.addStateChangedListener(updateNativeQuickReply);

const OPERATIONS: ReadonlyArray<Operation<any>> = [
    operation({
        description: 'add dialog',
        condition: ALWAYS,
        dependencies: { body: 'body', board: '.board' },
        // deferUntil: ALWAYS, // seems to be fine to drop this
        action: e => {
            const { body, board } = e;
            // @ts-ignore
            g.infoSection.insert(body);
            const channel = new BroadcastChannel('supersecrittobechangedlater');
            interact('.wallet.info').draggable({
                allowFrom: '.drag-handle',
                listeners: {
                    move (event) {
                        // @ts-ignore
                        const position = g.state?.transformInfoSection.position || { x: 0, y: 0 };
                        position.x += event.dx;
                        position.y += event.dy;

                        channel.postMessage({
                            type: 'move',
                            data: {
                                selector: '.wallet.info',
                                position,
                            },
                        });
                    },
                },
                modifiers: [
                    interact.modifiers.restrictRect({
                        restriction: 'parent'
                    })
                ]
            })
                .styleCursor(false);
            /*
                .on('down', e => {
                    e.preventDefault();
                    board.style.userSelect = board.style.pointerEvents = 'none';
                })
                .on('up', e => {
                    e.preventDefault();
                    board.style.userSelect = board.style.pointerEvents = 'unset';
                })
                .on('cancel', e => {
                    e.preventDefault();
                    board.style.userSelect = board.style.pointerEvents = 'unset';
                })
                */
                /*
            body.addEventListener('mouseenter', e => {
                //console.log(e);
            });
            ['mouseleave', 'mouseup'].forEach(evType => {
                body.addEventListener(evType, e => {
                    e.preventDefault();
                    board.style.userSelect = board.style.pointerEvents = 'unset';
                });
            });*/
            // todo all of this is a bit wonky, still
            //      adding the styles locally instead of globally might help
        },
    }),
    operation({
        description: 'listen to qr file',
        condition: ALWAYS,
        dependencies: {},
        action: e => {
            // fixme optimize this
            document.addEventListener('QRDialogCreation', function(e) {
                const fi = document.querySelector('#qr-filename');
                if(!fi) return;
                const config = { attributes: true, childList: true, subtree: true };
                const callback = function(mutationsList: any, observer: any) {
                    for(const mutation of mutationsList) {
                        if (mutation.type === 'attributes') {
                            const event = new CustomEvent('QRGetFile', {bubbles: true});
                            document.dispatchEvent(event);
                        }
                    }
                };
                const observer = new MutationObserver(callback);
                observer.observe(fi, config);
            }, false);
        },
    }),
    operation({
        description: 'listen to posts',
        condition: ALWAYS,
        dependencies: {},
        action: e => {
            document.addEventListener('QRFile', async (e: CustomEventInit) => {
                if (!e) {
                    return;
                }
                const name = e.detail?.name;
                if (!name) {
                    return;
                }
                // todo: figure out when to grab the fresh address
                // @ts-ignore
                let newName = encryptAddress(await g.state.wallet.getAddressAsync());
                if (name === newName) {
                    return;
                }
                let detail = {name: newName, file: new Blob([e.detail], {type: e.detail.type})};
                // @ts-ignore
                if (typeof cloneInto === 'function') {
                    // @ts-ignore
                    detail = cloneInto(detail, document.defaultView);
                }
                const event = new CustomEvent('QRSetFile', {bubbles: true, detail: detail});
                document.dispatchEvent(event);
            }, false);
        },
    }),
    operation({
        description: "detect 4chan-x",
        condition: ALWAYS,
        dependencies: {},
        action: e => {
            g.fourchanX = !!document.querySelector('.fourchan-x');
            document.addEventListener('4chanXInitFinished', () => { // fallback
                g.fourchanX = true;
                // @ts-ignore
                g.infoSection?.update();
            }, false);
        }
    }),
    operation({
        description: 'add notice to native qr',
        condition: () => !g.fourchanX,
        dependencies: {},
        deferUntil: DOMCONTENTLOADED,
        action: e => {
            const config = { attributes: false, childList: true, subtree: false };
            const callback = function(mutationList: any) {
                mutationList.forEach((mutation: MutationRecord) => {
                    if (mutation.type !== 'childList') return;
                    mutation.addedNodes?.forEach(updateNativeQuickReply);
                });
            }
            const observer = new MutationObserver(callback);
            observer.observe(document.body, config);
        },
    }),
    operation({
        description: "filter posts that we care about",
        condition: ALWAYS,
        dependencies: { thread: '.thread' },
        action: e => {
            thread = new Thread(e.thread as HTMLDivElement);
            // @ts-ignore
            g.infoSection.addThread(thread);
            console.time();
            thread.processNodes();
        },
    }),
    operation({
        description: "append mutation observer to thread which filters posts",
        condition: ALWAYS,
        dependencies: { thread: '.thread' },
        action: e => {
            const config = { attributes: false, childList: true, subtree: true };
            const callback = function(mutationList: any) {
                mutationList.forEach((mutation: any) => {
                    if (mutation.type !== 'childList') return;
                    if (mutation.addedNodes[0]) {
                        const postContainers = Array.prototype.filter.call(mutation.addedNodes, (el: any) => {
                            return el?.nodeName === "DIV" && el.classList.contains("postContainer");
                        });
                        if (!postContainers[0]) return; // todo be more concise. important part: "postcontainer" filter
                        // todo doesn't take into account siblings?
                        thread.processNodes(postContainers);
                        return;
                    }
                    mutation.removedNodes?.forEach((node: Element) => {
                        // todo fix this for Thread
                        if (node?.nodeName !== "DIV") return;
                        let postIdsSelector = [...posts.keys()].map(s=>`#${s}`);
                        if (!postIdsSelector.length) return;
                        node.querySelectorAll(postIdsSelector.join(','))
                            .forEach(node => posts.delete(Post.getPostId(node)));
                        // @ts-ignore
                        g.state.infoSection?.update(); // todo this shouldn't be needed when relating all balances back to the leading post
                    });
                });
            }
            const observer = new MutationObserver(callback);
            observer.observe(e.thread, config);
        }
    }),
];

export default OPERATIONS;
